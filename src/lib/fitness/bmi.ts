/**
 * #505: BMI 계산 (순수). Garmin 체중 행은 bmi 를 주지 않는 경우가 많아(체성분 체중계 없음)
 * 표시 시점에 프로필 키로 계산한다 — DB 는 Garmin 원본 그대로 두고, 키가 바뀌면 표시도 따라간다.
 */

/** 체중(kg) / 키(m)² — 소수점 1자리. 키나 체중이 없거나 0 이하면 null. */
export function computeBmi(
  weightKg: number,
  heightCm: number | null | undefined
): number | null {
  if (!heightCm || heightCm <= 0 || weightKg <= 0) return null;
  const heightM = heightCm / 100;
  return Number((weightKg / (heightM * heightM)).toFixed(1));
}

/** 저장된 BMI (Garmin 원본 · 수동 입력 시점 계산값) 우선, 없으면 키로 계산. */
export function resolveBmi(
  storedBmi: number | null,
  weightKg: number,
  heightCm: number | null | undefined
): number | null {
  return storedBmi ?? computeBmi(weightKg, heightCm);
}
