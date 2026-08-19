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
// Codex P2 (PR #316 8회차): Map 무한 성장 방지. TTL 은 return 만 막고 삭제 안 함 → long-lived
// 프로세스에서 distinct query 계속 축적. size cap + set 시 expired 정리 + FIFO eviction.
const MAX_CACHE_SIZE = 1000;

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
  // Codex P2 (PR #316 8회차): nutrient 값은 non-negative. 음수는 malformed → null.
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
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

/** row 를 MfdsHit 로 파싱. 실패 시 null.
 *  Codex P2 (PR #316 7회차): legacy `NUTR_CONT*` 필드 (openapi.foodsafetykorea.go.kr I2790)
 *  는 "per serving" 인데 이 parser 는 per-100g 로 취급 → scaleFromHit 이 quantityG/100 로
 *  곱해 값이 잘못 스케일 (예: 30g serving 150 kcal 이 45 kcal 로 저장). 후보에서 제거해
 *  legacy endpoint (다른 semantics) 를 명시적으로 미지원. 정확 스펙 없이는 SERVING_WT 로
 *  정규화 불가 — 필요 시 별도 parser 로 확장.
 */
function rowToHit(row: Record<string, unknown>): MfdsHit | null {
  const name = toStr(pickField(row, ["FOOD_NM_KR", "foodNm", "food_nm"]));
  const kcal = toNumOrNull(pickField(row, ["AMT_NUM1", "enerc"]));
  const carbs = toNumOrNull(pickField(row, ["AMT_NUM6", "chocdf"]));
  const protein = toNumOrNull(pickField(row, ["AMT_NUM3", "prot"]));
  const fat = toNumOrNull(pickField(row, ["AMT_NUM4", "fatce"]));
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
 * Codex P2 (PR #316 3/6회차): items 전체를 랭킹해 최고 스코어 match 선택. 임계 미만이면 null.
 * Codex P2 (PR #316 6회차): envelopeValid 반환 — HTTP 200 이지만 구조 오류 (null, {}, header
 * 없음 등) 는 negative cache 로 두면 안 됨 (transient 취급). caller 가 envelopeValid=true
 * 인 경우만 캐시. 동률 tie-breaker: candidate name 짧을수록 generic → 원본 query 에 가까움.
 */
export interface ParseResult {
  hit: MfdsHit | null;
  envelopeValid: boolean;
}

function parseMfdsResponse(payload: unknown, query: string): ParseResult {
  if (!payload || typeof payload !== "object") {
    return { hit: null, envelopeValid: false };
  }
  const root = payload as Record<string, unknown>;
  const header = root.header as Record<string, unknown> | undefined;
  if (!header || header.resultCode === undefined) {
    // envelope 자체가 없음 → 서비스 오류/schema 문제. cache X.
    return { hit: null, envelopeValid: false };
  }
  if (header.resultCode !== "00") {
    console.warn(
      `[mfds] API resultCode=${String(header.resultCode)} msg=${String(header.resultMsg ?? "?")}`,
    );
    // transient/config — cache X.
    return { hit: null, envelopeValid: false };
  }
  const body = root.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") {
    return { hit: null, envelopeValid: false };
  }
  const itemsRaw = body.items;
  let itemArr: unknown[] = [];
  if (Array.isArray(itemsRaw)) itemArr = itemsRaw;
  else if (itemsRaw && typeof itemsRaw === "object") {
    const nested = (itemsRaw as { item?: unknown }).item;
    if (Array.isArray(nested)) itemArr = nested;
    else if (nested) itemArr = [nested];
  } else if (itemsRaw !== undefined) {
    // items 존재하지만 배열/객체 형태 아님 → structural.
    return { hit: null, envelopeValid: false };
  }
  // items 필드 자체가 없거나 빈 배열이면 real no-match — cache OK.
  if (itemArr.length === 0) {
    return { hit: null, envelopeValid: true };
  }

  let best: { hit: MfdsHit; score: number } | null = null;
  for (const raw of itemArr) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const hit = rowToHit(row);
    if (!hit) continue;
    const refName = toStr(pickField(row, ["FOOD_REF_NM", "foodRefNm"]));
    const score = scoreCandidate(hit.name, refName, query);
    if (score < MATCH_SCORE_THRESHOLD) continue;
    if (!best) {
      best = { hit, score };
    } else if (score > best.score) {
      best = { hit, score };
    } else if (score === best.score && hit.name.length < best.hit.name.length) {
      // Codex P2 (PR #316 6회차): 동률 tie-breaker — candidate name 짧을수록 generic 이라
      // "김치찌개" 같은 base query 에 더 부합. FOOD_REF_NM 매치가 90 동률로 여럿 나오는
      // 케이스에서 API 순서 대신 결정적 (name length) 로 선택.
      best = { hit, score };
    }
    if (best.score >= 100) break; // exact — 더 볼 필요 없음.
  }
  if (!best) {
    console.warn(
      `[mfds] no defensible match for "${query}" (candidates=${itemArr.length})`,
    );
    // envelope 정상 + 후보 있지만 정합성 낮음 → real no-defensible-match — cache OK.
    return { hit: null, envelopeValid: true };
  }
  return { hit: best.hit, envelopeValid: true };
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
  if (cached) {
    if (cached.expiresAt > now) return cached.hit;
    // Codex P2 (PR #316 8회차): expired 발견 시 즉시 삭제 (accumulation 방지).
    cache.delete(key);
  }

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
        // Codex P2 (PR #316 6회차): parseMfdsResponse 가 envelope 유효성 (header/body 구조 +
        // resultCode "00") 을 판단. envelopeValid=true 인 경우만 캐시 → HTTP 200 이지만 null,
        // {}, header 없음 등 structural failure 는 다음 호출 재시도. resultCode !="00" 도 여기
        // 서 함께 처리.
        const parsed = parseMfdsResponse(payload, trimmed);
        hit = parsed.hit;
        cacheable = parsed.envelopeValid;
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
    // Codex P2 (PR #316 8회차): set 시 만료된 entries 정리 + size cap 초과 시 FIFO eviction.
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
    while (cache.size >= MAX_CACHE_SIZE) {
      // Map iterator 는 insertion order — 가장 오래된 것부터 삭제.
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    cache.set(key, { hit, expiresAt: now + CACHE_TTL_MS });
  }
  return hit;
}

/** 테스트 편의 — 캐시 비움. */
export function clearMfdsCache(): void {
  cache.clear();
}
