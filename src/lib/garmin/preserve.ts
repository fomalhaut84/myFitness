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

/**
 * upsert 의 `update` payload. null 필드는 생략하고, 응답에 상세가 없는데 기존 행에는 있으면 `rawData` 도 생략한다 (기존 유지).
 * 둘 다 상세가 없으면 rawData 는 갱신한다 — 요약이라도 최신으로. 파생 컬럼 (`avgHR` · `hrvOvernight`) 은 null 이라 첫 규칙이 뺀다.
 */
export function preserveUpdate<T extends Record<string, unknown>>(data: T, ctx: { incomingDetail: boolean; existingDetail: boolean }): Partial<T> {
  const out = withoutNulls(data);
  if (!ctx.incomingDetail && ctx.existingDetail) delete out.rawData;
  return out;
}
