// #315 (M14 Phase 2 #4): 오픈식약처 식품영양성분DB (공공데이터포털) 클라이언트.
// - 검색어로 100g 당 kcal/P/C/F 조회 → caller 가 quantityG 로 scale.
// - 실패 (network / API error / no match) 시 null 반환 → caller (AI estimator) 폴백.
// - in-memory cache (24h TTL) 로 rate limit 방어. negative cache 포함.

// 사용자 endpoint: 공공데이터포털 `식품의약품안전처_식품영양성분DB정보 (통합)`.
// data.go.kr 는 서비스마다 sub-path (operation name) 이 다름 — env 로 override 가능.
const DEFAULT_BASE_URL =
  "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02";
const DEFAULT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface MfdsHit {
  /** DB 상 정식 식품명 */
  name: string;
  /** 100g 당 kcal */
  kcalPer100g: number;
  /** 100g 당 protein g */
  proteinPer100g: number | null;
  /** 100g 당 carbs g */
  carbsPer100g: number | null;
  /** 100g 당 fat g */
  fatPer100g: number | null;
  /** 1회 제공량 g (없으면 null) */
  servingSizeG: number | null;
}

interface CacheEntry {
  hit: MfdsHit | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** 검색어를 캐시 key 로. lowercase + trim. */
function normalizeKey(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

/** data.go.kr 응답 필드명은 서비스마다 조금씩 다름. 여러 후보 이름에서 첫 non-null 값 반환. */
function pickField(row: Record<string, unknown>, candidates: string[]): unknown {
  for (const name of candidates) {
    const v = row[name];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toNumOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  // "100g", "1.5kg" 등 unit 붙은 값 대응 — 첫 숫자만 추출.
  const raw = typeof v === "number" ? String(v) : String(v).trim();
  const m = raw.match(/^-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Codex P2 (PR #316 3회차): 검색어 vs candidate name 유사도 스코어. FOOD_NM_KR 부분매치는
 * "김치찌개" → "김치찌개_꽁치" 같은 variant 를 첫 결과로 반환할 수 있어 랭킹 없이 accept
 * 하면 nutritionally 다른 항목이 high-confidence 로 저장/캐시됨.
 * - exact normalize 일치: 100
 * - underscore/괄호 앞 base name 일치 (예: "김치찌개_꽁치" → base "김치찌개"): 80
 * - startsWith: 60
 * - contains (원본 fallback): 40
 * - 그 외: 0 (임계 threshold 로 필터)
 */
const MATCH_SCORE_THRESHOLD = 60;

function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function scoreCandidate(
  candidateName: string,
  refName: string | null,
  query: string,
): number {
  const nq = normalizeName(query);
  const nc = normalizeName(candidateName);
  if (!nq || !nc) return 0;
  // 100: 정확 이름 일치.
  if (nc === nq) return 100;
  // 90: FOOD_REF_NM (참조 카테고리 이름) 일치 — variant 여러 개가 같은 카테고리를 공유하는
  //     경우 defensible match (예: query "김치찌개" ↔ FOOD_REF_NM "김치찌개" · 여러 variants).
  if (refName && normalizeName(refName) === nq) return 90;
  // 80: underscore/괄호 앞 base name 일치 (참조 필드 없는 경우 fallback).
  const base = nc.split(/[_(（\[]/)[0].trim();
  if (base === nq) return 80;
  if (nc.startsWith(nq)) return 60;
  if (nc.includes(nq)) return 40;
  return 0;
}

/** row 를 MfdsHit 로 파싱. 실패 시 null. */
function rowToHit(row: Record<string, unknown>): MfdsHit | null {
  const name = toStr(pickField(row, ["FOOD_NM_KR", "foodNm", "food_nm", "DESC_KOR"]));
  const kcal = toNumOrNull(pickField(row, ["AMT_NUM1", "enerc", "NUTR_CONT1"]));
  const carbs = toNumOrNull(pickField(row, ["AMT_NUM6", "chocdf", "NUTR_CONT2"]));
  const protein = toNumOrNull(pickField(row, ["AMT_NUM3", "prot", "NUTR_CONT3"]));
  const fat = toNumOrNull(pickField(row, ["AMT_NUM4", "fatce", "NUTR_CONT4"]));
  const servingRaw = toNumOrNull(
    pickField(row, ["SERVING_SIZE", "servSize", "STD_SIZE", "srvSize"]),
  );
  if (!name || kcal === null) return null;
  return {
    name,
    kcalPer100g: kcal,
    proteinPer100g: protein,
    carbsPer100g: carbs,
    fatPer100g: fat,
    servingSizeG: servingRaw !== null && servingRaw > 0 ? servingRaw : null,
  };
}

/**
 * data.go.kr 표준 응답: { header: {resultCode, resultMsg}, body: { items: [...], totalCount, ... } }
 * items 는 배열 or 객체 (단일 결과일 때 축소되는 서비스 있음).
 * Codex P2 (PR #316 3회차): items 전체를 랭킹해 최고 스코어 match 선택. 임계 미만이면 null.
 */
function parseMfdsResponse(payload: unknown, query: string): MfdsHit | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const header = root.header as Record<string, unknown> | undefined;
  if (header && header.resultCode !== undefined && header.resultCode !== "00") {
    console.warn(
      `[mfds] API resultCode=${String(header.resultCode)} msg=${String(header.resultMsg ?? "?")}`,
    );
    return null;
  }
  const body = root.body as Record<string, unknown> | undefined;
  const itemsRaw = body?.items;
  let itemArr: unknown[] = [];
  if (Array.isArray(itemsRaw)) itemArr = itemsRaw;
  else if (itemsRaw && typeof itemsRaw === "object") {
    const nested = (itemsRaw as { item?: unknown }).item;
    if (Array.isArray(nested)) itemArr = nested;
    else if (nested) itemArr = [nested];
  }
  if (itemArr.length === 0) return null;

  let best: { hit: MfdsHit; score: number } | null = null;
  for (const raw of itemArr) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const hit = rowToHit(row);
    if (!hit) continue;
    const refName = toStr(pickField(row, ["FOOD_REF_NM", "foodRefNm"]));
    const score = scoreCandidate(hit.name, refName, query);
    if (score < MATCH_SCORE_THRESHOLD) continue;
    if (!best || score > best.score) best = { hit, score };
    if (best.score >= 100) break; // exact — 더 볼 필요 없음.
  }
  if (!best) {
    console.warn(
      `[mfds] no defensible match for "${query}" (candidates=${itemArr.length})`,
    );
    return null;
  }
  return best.hit;
}

export interface FetchMfdsOptions {
  timeoutMs?: number;
  /** 테스트용 fetch 주입 (env 없이) */
  fetchImpl?: typeof fetch;
  /** 원본 응답 로깅 (테스트 스크립트에서 필드명 확인용) */
  logRaw?: boolean;
}

/** 검색어로 첫 매치 hit 반환. 캐시 우선. */
export async function fetchMfdsFood(
  query: string,
  opts: FetchMfdsOptions = {},
): Promise<MfdsHit | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const key = normalizeKey(trimmed);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.hit;

  const apiKeyRaw = process.env.MFDS_API_KEY;
  if (!apiKeyRaw) {
    console.warn("[mfds] MFDS_API_KEY 환경변수 없음 — AI 폴백");
    return null;
  }
  // Codex P2 (PR #316 4회차): data.go.kr 는 "Encoding key" (URL-encoded, %2B / %3D 포함) 와
  // "Decoding key" (raw) 를 별도 제공. URLSearchParams.set 은 값을 재-encode 하므로 encoded
  // key 를 그대로 넣으면 %252B, %253D 등 double-encoded → API reject. `%` 포함되면 이미
  // encoded 로 판정하고 decodeURIComponent 로 원본 복구 → set 시 정상 재-encode.
  let apiKey = apiKeyRaw;
  if (apiKey.includes("%")) {
    try {
      apiKey = decodeURIComponent(apiKey);
    } catch (err) {
      console.warn(
        `[mfds] MFDS_API_KEY decode 실패 (raw 그대로 사용): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Codex P2 (PR #316 2회차): MFDS_BASE_URL override 가 malformed 이면 new URL 이 sync
  // throw → caller (API route / bot / backfill) 로 전파돼 log 저장 못 하고 AI 폴백도 못 함
  // (client 의 failure-to-null 컨벤션 위반). URL 생성을 try 로 감싸 null 반환.
  const baseUrl = process.env.MFDS_BASE_URL || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (err) {
    console.warn(
      `[mfds] MFDS_BASE_URL 파싱 실패 ("${baseUrl}"): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("type", "json");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "5");
  url.searchParams.set("FOOD_NM_KR", trimmed);

  const fetchFn = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let hit: MfdsHit | null = null;
  // 사전 리뷰 P1 (feat/315-1): transient error (network/HTTP 5xx/timeout/parse fail) 을
  // negative cache 로 24h poisoning 하면 API 복구된 후에도 그 검색어는 24h 재시도 불가 →
  // MFDS 정확도 이점 무력화. 정상 응답을 파싱한 경우 (hit=null 인 real "no match" 포함) 만
  // 캐시. Transient 는 다음 호출에서 재시도.
  let cacheable = false;
  try {
    const res = await fetchFn(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "(no body)");
      console.warn(
        `[mfds] HTTP ${res.status} for "${trimmed}": ${errBody.slice(0, 500)}`,
      );
      // HTTP non-2xx — transient (5xx) or auth issue (401/403). 캐시 X (다음 재시도).
    } else {
      const rawText = await res.text();
      if (opts.logRaw) {
        console.log(`[mfds] raw response for "${trimmed}":`);
        console.log(rawText.slice(0, 2000));
      }
      try {
        const payload = JSON.parse(rawText);
        // Codex P2 (feat/315-1 2회차): HTTP 200 인데 header.resultCode !== "00" 은
        // auth/quota/rate-limit 등 transient·config 오류. parseMfdsResponse 는 null 로
        // 반환하지만 이전엔 cacheable=true 로 마킹 → 24h negative cache poisoning →
        // 서비스/자격 복구 후에도 그 검색어 24h 불가. resultCode "00" 확인 후에만 캐시.
        const header = (payload as { header?: { resultCode?: unknown } })?.header;
        const resultCode = header?.resultCode;
        if (resultCode !== undefined && resultCode !== "00") {
          console.warn(
            `[mfds] API resultCode=${String(resultCode)} for "${trimmed}" — transient/config, 캐시 X`,
          );
          // cacheable 은 false 로 유지 → 다음 호출 재시도.
        } else {
          hit = parseMfdsResponse(payload, trimmed);
          cacheable = true; // 성공 응답 (hit 유무 무관) 만 캐시
        }
      } catch (err) {
        console.warn(
          `[mfds] JSON parse 실패 for "${trimmed}": ${err instanceof Error ? err.message : String(err)}`,
        );
        // parse 실패는 서버 오류 가능성 — 캐시 X
      }
    }
  } catch (err) {
    console.warn(
      `[mfds] fetch 실패 for "${trimmed}": ${err instanceof Error ? err.message : String(err)}`,
    );
    // network / AbortError (timeout) — 캐시 X
  } finally {
    clearTimeout(timer);
  }

  if (cacheable) {
    cache.set(key, { hit, expiresAt: now + CACHE_TTL_MS });
  }
  return hit;
}

/** 테스트 편의 — 캐시 비움. */
export function clearMfdsCache(): void {
  cache.clear();
}
