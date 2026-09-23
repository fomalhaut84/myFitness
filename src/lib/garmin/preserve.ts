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

/** 심박 응답에 하루치 시계열이 있는가 (`heartRateValues` 비지 않은 배열) */
export function hasHeartRateDetail(raw: unknown): boolean {
  const r = asRecord(raw);
  return r !== null && Array.isArray(r.heartRateValues) && r.heartRateValues.length > 0;
}

/**
 * 수면 응답에 상세가 있는가 — 야간 HRV (`avgOvernightHrv` 유한수) **만** 본다. `sleepLevels` 는 보존 창 밖에서도 올 수 있어
 * (Garmin Connect 는 수년 전 수면 단계도 보여 준다) OR 조건에 넣으면 HRV 없는 재조회가 rawData 를 다시 덮어쓴다 (사전 리뷰 major 1).
 * 소실이 실측된 필드만 기준으로 한다.
 */
export function hasSleepDetail(raw: unknown): boolean {
  const r = asRecord(raw);
  return r !== null && typeof r.avgOvernightHrv === "number" && Number.isFinite(r.avgOvernightHrv);
}

/** "값 있음" — 비지 않은 배열 · 0 이 아닌 유한수 · 비지 않은 객체. 문자열 · 불리언 · 0 · 빈 컨테이너는 요약/플래그라 세지 않는다 */
function isPresent(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  if (v !== null && typeof v === "object") return Object.keys(v as object).length > 0;
  return false;
}

/**
 * #435: 응답이 기존 rawData 보다 빈약한가 — 기존의 "값 있음" 최상위 키 중 하나라도 응답에서 사라졌으면 (null · 없음 · 빈 배열)
 * 보존 창 밖 재조회로 본다. 특정 필드 (`heartRateValues` · `avgOvernightHrv`) 만 보면 HRV 없는 밤의 SpO2 epochs · `sleepHeartRate`
 * 타임라인을 놓친다 (릴리즈 PR #434 Codex P2). 값 변경 · 새 키 추가 · 요약 갱신은 trimmed 가 아니다.
 */
export function isTrimmedResponse(incoming: unknown, existing: unknown): boolean {
  const prev = asRecord(existing);
  if (prev === null) return false;
  const presentKeys = Object.keys(prev).filter((k) => isPresent(prev[k]));
  if (presentKeys.length === 0) return false;
  const next = asRecord(incoming);
  if (next === null) return true;
  return presentKeys.some((k) => !isPresent(next[k]));
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
