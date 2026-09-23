// #431: 재싱크 덮어쓰기 가드 — Garmin 은 일별 wellness 상세 (하루치 심박 시계열 · 야간 HRV) 를 최근 약 150일만 준다.
// 그 밖의 날짜는 요약만 있고 상세가 null 이라, 옛 날짜를 다시 싱크하면 (backfill:history · 장기 실패 후 복구) 기존 값이
// null 로 덮어써진다 — 2026-09-17 백필이 2025-11 ~ 2026-04-19 의 heartRateValues · avgHR · hrvOvernight 를 지웠다.
// 규칙: update 에서 null 인 필드는 생략 (Prisma `undefined` = 무변경), 상세가 빠진 응답이면 rawData 도 기존 유지.
// 순수 모듈 — fetcher (heart-rate · sleep) 와 backfill:history 가 공유.

/** Garmin 일별 wellness 상세 보존 창 (일). 2026-09-17 기준 경계 2026-04-20 실측 (memory `project_garmin_wellness_retention`) */
export const WELLNESS_RETENTION_DAYS = 150;

/** null · undefined 키를 뺀 복사본 — Prisma update 에서 `undefined` 는 무변경. 0 · false · "" · [] 는 값이므로 남긴다 */
export function withoutNulls<T extends Record<string, unknown>>(data: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(data) as Array<keyof T>) {
    const v = data[key];
    if (v !== null && v !== undefined) out[key] = v;
  }
  return out;
}

const asRecord = (raw: unknown): Record<string, unknown> | null => (raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null);

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** "값 있음" — 비지 않은 배열 · 0 이 아닌 유한수 · 비지 않은 객체. 문자열 · 불리언 · 0 · 빈 컨테이너는 요약/플래그라 세지 않는다 */
function isPresent(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return false;
}

/**
 * `prev` 에 있던 값이 `next` 에서 사라졌는가 — 객체는 **재귀** (PR #436 Codex P2: `dailySleepDTO.averageSpO2Value` 처럼 중첩 필드만 빠지고
 * 부모 객체는 비지 않은 채 오는 응답). 배열 · 수치는 잎으로 비교 (값 변경 · 길이 변경은 소실이 아니다)
 */
function hasLost(prev: unknown, next: unknown): boolean {
  if (isPlainObject(prev)) {
    if (!isPlainObject(next)) return Object.keys(prev).some((k) => isPresent(prev[k]) || isPlainObject(prev[k]));
    return Object.keys(prev).some((k) => hasLost(prev[k], next[k]));
  }
  return isPresent(prev) && !isPresent(next);
}

/**
 * #435: 응답이 기존 rawData 보다 빈약한가 — 기존의 "값 있음" 키 (중첩 포함) 중 하나라도 응답에서 사라졌으면 (null · 없음 · 빈 배열 · 0)
 * 보존 창 밖 재조회로 본다. 특정 필드 (`heartRateValues` · `avgOvernightHrv`) 만 보면 HRV 없는 밤의 SpO2 epochs · `sleepHeartRate`
 * 타임라인을 놓친다 (릴리즈 PR #434 Codex P2). 값 변경 · 새 키 추가 · 요약 갱신은 trimmed 가 아니다.
 * 단 0 아닌 수치 → 0 / null 은 trimmed 로 본다 (사전 리뷰 info 1) — 그때도 컬럼은 `withoutNulls` 로 갱신되고 rawData 만 유지된다.
 */
export function isTrimmedResponse(incoming: unknown, existing: unknown): boolean {
  const prev = asRecord(existing);
  if (prev === null || !isPresent(prev)) return false;
  if (!Object.keys(prev).some((k) => isPresent(prev[k]))) return false;
  return hasLost(prev, incoming);
}

/**
 * upsert 의 `update` payload. null 필드는 생략하고, 응답이 기존보다 빈약하면 (`trimmed`) `rawData` 도 생략한다 (기존 유지).
 * 파생 컬럼 (`avgHR` · `hrvOvernight`) 은 null 이라 첫 규칙이 뺀다.
 */
export function preserveUpdate<T extends Record<string, unknown>>(data: T, ctx: { trimmed: boolean }): Partial<T> {
  const out = withoutNulls(data);
  if (ctx.trimmed) delete out.rawData;
  return out;
}
