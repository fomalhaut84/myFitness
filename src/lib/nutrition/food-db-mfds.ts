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
 * data.go.kr 표준 응답: { header: {resultCode, resultMsg}, body: { items: [...], totalCount, ... } }
 * items 는 배열 or 객체 (단일 결과일 때 축소되는 서비스 있음).
 */
function parseMfdsResponse(payload: unknown): MfdsHit | null {
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
  const first = itemArr[0];
  if (!first || typeof first !== "object") return null;
  const row = first as Record<string, unknown>;

  // 필드 이름 후보 (data.go.kr 다양한 스펙 커버):
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

  const apiKey = process.env.MFDS_API_KEY;
  if (!apiKey) {
    console.warn("[mfds] MFDS_API_KEY 환경변수 없음 — AI 폴백");
    return null;
  }

  const baseUrl = process.env.MFDS_BASE_URL || DEFAULT_BASE_URL;
  const url = new URL(baseUrl);
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
        hit = parseMfdsResponse(payload);
        cacheable = true; // 정상 응답 (hit 유무 무관) 만 캐시
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
