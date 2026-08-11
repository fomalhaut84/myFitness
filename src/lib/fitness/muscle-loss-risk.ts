// #299 (M14 Phase 2 #3): 러너 근손실 위험 평가.
// 세 조건 (kcal 결손 · 단백질/kg · 고강도 볼륨) 을 각각 +1 스코어로 합산 → 3점 척도.
//   - kcal 결손 > 500/day (일평균) → +1
//   - 단백질 < target × 0.9 g/kg (10% margin) → +1
//   - 주간 고강도 (Z4+) > 30분 → +1
// 스코어 3 → high, 2 → medium, ≤1 → low.
//
// 목적: AI 리포트 프롬프트에 주입해 러너에게 실행 가능한 경고/권장을 제공.

export interface MuscleLossInput {
  /**
   * 최근 7일 avg kcal/day (out - in). 양수면 결손.
   * Codex P2 (PR #300): null 이면 결손 데이터 자체가 없다는 뜻. 스코어에는 반영 안 하고
   * reasons 에만 표시. 이 필드가 0 이었으면 "안전" 으로 오인될 수 있어 명시적 unknown 필요.
   */
  weeklyCalorieDeficit: number | null;
  /**
   * 최근 7일 avg 단백질 g/kg 체중. null 이면 데이터 부족을 reasons 에만 표시하고
   * 스코어에는 반영하지 않는다 (false-positive 회피). caller 가 daysWithProteinData 를
   * 함께 참조해 신뢰도 판단.
   */
  avgProteinPerKg: number | null;
  /** 최근 7일 고강도 (Z4+Z5) 총 분. */
  weeklyHighIntensityMin: number;
  /** UserProfile.proteinTargetPerKg (기본 1.6). */
  proteinTargetPerKg: number;
  /**
   * Codex P2 (PR #300): 최근 체중 kg. 단백질 권장을 g 절대값으로 환산해 실행 가능하게.
   * 없으면 g/kg gap 만 표시 (계란/닭가슴살 환산 스킵).
   */
  bodyWeightKg?: number | null;
}

export interface MuscleLossVerdict {
  risk: "low" | "medium" | "high";
  score: number;
  reasons: string[];
  recommendations: string[];
}

const DEFICIT_THRESHOLD = 500;
const PROTEIN_MARGIN = 0.9; // target × 0.9 = 보수적 임계.
const HIGH_INTENSITY_THRESHOLD_MIN = 30;

const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

export function assessMuscleLossRisk(input: MuscleLossInput): MuscleLossVerdict {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // 결손 조건
  if (input.weeklyCalorieDeficit === null) {
    reasons.push("칼로리 밸런스 데이터 부족 (최근 7일 기록 미완)");
  } else {
    const deficit = Math.round(input.weeklyCalorieDeficit);
    if (deficit > DEFICIT_THRESHOLD) {
      score++;
      reasons.push(`일평균 결손 ${deficit} kcal (> ${DEFICIT_THRESHOLD})`);
      // Codex P2 (PR #300 6회차): 큰 결손에 0.6 곱만 하면 여전히 threshold 초과 값을 권장하는
      // 모순 (예: 1000 kcal → 600 kcal). 권장은 항상 DEFICIT_THRESHOLD 이하 · 최소 300 kcal.
      const suggested = Math.min(
        DEFICIT_THRESHOLD,
        Math.max(300, Math.round(deficit * 0.6)),
      );
      recommendations.push(`결손을 ${suggested} kcal 이내로 완화`);
    }
  }

  // 단백질 조건
  const target = input.proteinTargetPerKg;
  const proteinFloor = target * PROTEIN_MARGIN;
  if (input.avgProteinPerKg === null) {
    // 데이터 없음 — 보수적으로 score 증가하지 않고 reasons 에만 표시.
    reasons.push("단백질 매크로 데이터 부족 (7일 기록 미완)");
  } else if (input.avgProteinPerKg < proteinFloor) {
    score++;
    reasons.push(
      `단백질 ${fmt1(input.avgProteinPerKg)} g/kg (< ${fmt1(proteinFloor)} 권장 최소치, 목표 ${fmt1(target)})`,
    );
    // Codex P2 (PR #300 3회차): 체중을 알면 g 절대값으로 환산 (계란 1개 ≈ 6g P, 닭가슴살 100g ≈ 30g P).
    // 이전엔 고정 문구 (~계란 3개) 라 100kg 사용자의 큰 gap 을 심각하게 과소평가.
    const gapPerKg = target - input.avgProteinPerKg;
    if (input.bodyWeightKg && input.bodyWeightKg > 0) {
      const gapG = Math.round(gapPerKg * input.bodyWeightKg);
      const eggs = Math.max(1, Math.round(gapG / 6));
      const chickenG = Math.max(10, Math.round(gapG / 0.3 / 10) * 10); // 10g 단위 반올림
      recommendations.push(
        `단백질 하루 +${gapG}g 추가 (~계란 ${eggs}개 or 닭가슴살 ${chickenG}g 상당)`,
      );
    } else {
      recommendations.push(`단백질 하루 +${fmt1(gapPerKg)} g/kg 추가`);
    }
  }

  // 고강도 조건
  const zMin = Math.round(input.weeklyHighIntensityMin);
  if (zMin > HIGH_INTENSITY_THRESHOLD_MIN) {
    score++;
    reasons.push(`고강도(Z4+) 주 ${zMin} 분 (> ${HIGH_INTENSITY_THRESHOLD_MIN})`);
    recommendations.push("다음 7일 중 1~2회는 easy·회복 러닝으로 대체");
  }

  const risk: MuscleLossVerdict["risk"] = score >= 3 ? "high" : score >= 2 ? "medium" : "low";
  return { risk, score, reasons, recommendations };
}
