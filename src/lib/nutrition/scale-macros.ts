// #299 (M14 Phase 2 #3): 사용자 수동 kcal 정정 시 macro 를 같은 P:C:F 비율로 스케일.
// - PATCH /api/food/[id], 봇 /food_kcal, 봇 [수정] 답장 세 지점에서 공통 사용.
// - 이전엔 kcal 만 갱신하고 macro 는 이전 AI 추정값 유지 → mismatched 데이터 (Codex P2 PR #300).
// - 스케일 불가한 경우 (원본 kcal null 이거나 0) → macros 도 null 로 (backfill 이 재추정).

export interface MacroValues {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface ScaleMacrosResult {
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  /**
   * true 면 nutritionAttempts 도 리셋해야 함 (backfill 이 새 값으로 재추정 필요).
   * scaling 성공하면 false — 기존 attempts 유지.
   */
  resetAttempts: boolean;
}

// PrismaClient 타입은 caller 가 주입. 순환 import 방지 + 트랜잭션 클라이언트도 수용.
interface KcalCorrectableClient {
  foodLog: {
    findUnique: (args: {
      where: { id: string };
      select: { estimatedKcal: true; proteinG: true; carbsG: true; fatG: true };
    }) => Promise<{
      estimatedKcal: number | null;
      proteinG: number | null;
      carbsG: number | null;
      fatG: number | null;
    } | null>;
    updateMany: (args: {
      where: {
        id: string;
        estimatedKcal: number | null;
        proteinG: number | null;
        carbsG: number | null;
        fatG: number | null;
      };
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
}

export type ApplyKcalCorrectionResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "conflict" };

/**
 * Codex P2 (PR #300): 사용자 kcal 정정 (PATCH · 봇 /food_kcal · 봇 [수정] 답장) 을
 * concurrency-safe 하게 적용. fetch → scale → 스냅샷 매칭 update 를 최대 3회 재시도.
 * backfill 이 사이에 macros 를 채운 경우 stale null 로 stomp 하지 않음.
 */
export async function applyKcalCorrection(
  client: KcalCorrectableClient,
  id: string,
  newKcal: number,
): Promise<ApplyKcalCorrectionResult> {
  const MAX_ATTEMPT = 3;
  for (let i = 0; i < MAX_ATTEMPT; i++) {
    const existing = await client.foodLog.findUnique({
      where: { id },
      select: { estimatedKcal: true, proteinG: true, carbsG: true, fatG: true },
    });
    if (!existing) return { ok: false, reason: "not-found" };
    const scaled = scaleMacrosForNewKcal(newKcal, existing.estimatedKcal, existing);
    const res = await client.foodLog.updateMany({
      where: {
        id,
        estimatedKcal: existing.estimatedKcal,
        proteinG: existing.proteinG,
        carbsG: existing.carbsG,
        fatG: existing.fatG,
      },
      data: {
        estimatedKcal: newKcal,
        proteinG: scaled.proteinG,
        carbsG: scaled.carbsG,
        fatG: scaled.fatG,
        ...(scaled.resetAttempts ? { nutritionAttempts: null } : {}),
      },
    });
    if (res.count > 0) return { ok: true };
  }
  return { ok: false, reason: "conflict" };
}

/**
 * 새 kcal 로 macro 를 비율 스케일. 원본 kcal 이 unknown 이거나 새 kcal 이 null → macros null.
 * @param newKcal — 사용자가 지정한 새 kcal (null 가능)
 * @param oldKcal — 정정 전 kcal (null 가능)
 * @param oldMacros — 정정 전 macro (개별 null 가능)
 */
export function scaleMacrosForNewKcal(
  newKcal: number | null,
  oldKcal: number | null,
  oldMacros: MacroValues,
): ScaleMacrosResult {
  if (newKcal === null) {
    return { proteinG: null, carbsG: null, fatG: null, resetAttempts: true };
  }
  if (oldKcal === null || oldKcal <= 0) {
    // 스케일 기준 없음 → macros null 로 리셋해 backfill 이 재추정.
    return { proteinG: null, carbsG: null, fatG: null, resetAttempts: true };
  }
  if (newKcal === oldKcal) {
    // 값이 그대로면 macros 도 그대로.
    return {
      proteinG: oldMacros.proteinG,
      carbsG: oldMacros.carbsG,
      fatG: oldMacros.fatG,
      resetAttempts: false,
    };
  }
  const ratio = newKcal / oldKcal;
  const scale1 = (v: number | null): number | null =>
    v === null ? null : Math.round(v * ratio * 10) / 10;
  return {
    proteinG: scale1(oldMacros.proteinG),
    carbsG: scale1(oldMacros.carbsG),
    fatG: scale1(oldMacros.fatG),
    resetAttempts: false,
  };
}
