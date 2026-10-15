/**
 * 수동 체성분 입력 → BodyComposition 저장값 (순수).
 * #514 사전 리뷰 major 2: 같은 날 OMRON 행을 덮을 때 OMRON 전용 필드 (내장지방 · 기초대사 · 체연령 · 골격근률) 가 남으면
 * manual 행에 다른 시점 측정이 섞인다 → 명시적으로 비운다. OMRON 싱크는 manual 행을 건너뛰므로 이후에도 섞이지 않는다.
 */
export function manualBodyCompositionData(input: {
  weight: number;
  bmi: number | null;
  bodyFat?: number | null;
  muscleMass?: number | null;
}) {
  return {
    weight: input.weight,
    bmi: input.bmi,
    bodyFat: input.bodyFat ?? null,
    muscleMass: input.muscleMass ?? null,
    visceralFatLevel: null,
    basalMetabolism: null,
    bodyAge: null,
    skeletalMusclePct: null,
    source: "manual" as const,
  };
}
