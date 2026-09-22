// 러닝 거리 bucket 분류 + 페이스 포맷 공용 유틸.
// pace-progression / race-prediction 등에서 재사용하여 bucket 경계 drift 방지.

export type Bucket = "5k" | "10k" | "HM" | "FM";

/** 활동 거리(m) → bucket. 5k [4.5,5.5), 10k [9,11), HM [20,22), FM [40,44). */
export function bucketOf(distanceM: number): Bucket | null {
  const km = distanceM / 1000;
  if (km >= 4.5 && km < 5.5) return "5k";
  if (km >= 9.0 && km < 11.0) return "10k";
  if (km >= 20.0 && km < 22.0) return "HM";
  if (km >= 40.0 && km < 44.0) return "FM";
  return null;
}

/** 초/km → "m:ss" (반올림). */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
