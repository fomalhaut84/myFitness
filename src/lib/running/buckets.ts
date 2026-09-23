// 러닝 거리 bucket 분류 + 페이스 포맷 공용 유틸.
// pace-progression / race-prediction 등에서 재사용하여 bucket 경계 drift 방지.

export type Bucket = "5k" | "10k" | "HM" | "FM";

/** 버킷 경계 (m, [min, max)). #440: DB 조회 (거리 버킷 개인 최고) 도 같은 경계를 쓴다. */
export const BUCKET_RANGES_M: Readonly<Record<Bucket, { min: number; max: number }>> = {
  "5k": { min: 4500, max: 5500 },
  "10k": { min: 9000, max: 11000 },
  HM: { min: 20000, max: 22000 },
  FM: { min: 40000, max: 44000 },
};

/** 활동 거리(m) → bucket. 5k [4.5,5.5), 10k [9,11), HM [20,22), FM [40,44). */
export function bucketOf(distanceM: number): Bucket | null {
  for (const bucket of ["5k", "10k", "HM", "FM"] as const) {
    const r = BUCKET_RANGES_M[bucket];
    if (distanceM >= r.min && distanceM < r.max) return bucket;
  }
  return null;
}

/** 초/km → "m:ss" (반올림). */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
