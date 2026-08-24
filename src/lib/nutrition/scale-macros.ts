// #299 (M14 Phase 2 #3): 사용자 수동 kcal 정정 시 macro 를 같은 P:C:F 비율로 스케일.
// - PATCH /api/food/[id], 봇 /food_kcal, 봇 [수정] 답장 세 지점에서 공통 사용.
// - 이전엔 kcal 만 갱신하고 macro 는 이전 AI 추정값 유지 → mismatched 데이터 (Codex P2 PR #300).
// - 스케일 불가한 경우 (원본 kcal null 이거나 0) → macros 도 null 로 (backfill 이 재추정).

import { Prisma } from "@/generated/prisma/client";
import {
  scaleItemsForNewKcal,
  sanitizeFoodItemBreakdown,
} from "@/lib/nutrition/food-items";

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
      select: {
        estimatedKcal: true;
        proteinG: true;
        carbsG: true;
        fatG: true;
        description: true;
        updatedAt: true;
        items: true;
      };
    }) => Promise<{
      estimatedKcal: number | null;
      proteinG: number | null;
      carbsG: number | null;
      fatG: number | null;
      description: string;
      updatedAt: Date;
      items: Prisma.JsonValue | null;
    } | null>;
    updateMany: (args: {
      where: {
        id: string;
        estimatedKcal: number | null;
        proteinG: number | null;
        carbsG: number | null;
        fatG: number | null;
        description?: string;
        updatedAt?: Date;
      };
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
}

export type ApplyKcalCorrectionResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "conflict" | "stale" };

/**
 * Codex P2 (PR #300): 사용자 kcal 정정 (PATCH · 봇 /food_kcal · 봇 [수정] 답장) 을
 * concurrency-safe 하게 적용. fetch → scale → 스냅샷 매칭 update 를 최대 3회 재시도.
 * backfill 이 사이에 macros 를 채운 경우 stale null 로 stomp 하지 않음.
 *
 * Codex P2 (PR #313 9/12회차): expectedRevision (client 가 editor 열 시점의 row updatedAt) 이
 * 주어지면 fetch 시 실제 updatedAt 과 비교. mismatch 이면 `stale` 반환 — 사용자가 editor 를
 * 열고 있는 동안 다른 writer (bot description edit / backfill 등) 가 row 를 update 했다는
 * 뜻. description value 만 비교하면 A→B→A restore 케이스에서 우회 가능해 monotonic
 * revision 사용. 미지정 시 기존 동작 유지 (봇 등 legacy caller — snapshot 없이 lastwrite).
 */
export async function applyKcalCorrection(
  client: KcalCorrectableClient,
  id: string,
  newKcal: number,
  expectedRevision?: Date,
): Promise<ApplyKcalCorrectionResult> {
  const MAX_ATTEMPT = 3;
  for (let i = 0; i < MAX_ATTEMPT; i++) {
    const existing = await client.foodLog.findUnique({
      where: { id },
      select: {
        estimatedKcal: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        description: true,
        updatedAt: true,
        items: true,
      },
    });
    if (!existing) return { ok: false, reason: "not-found" };
    if (
      expectedRevision !== undefined &&
      existing.updatedAt.getTime() !== expectedRevision.getTime()
    ) {
      return { ok: false, reason: "stale" };
    }
    const scaled = scaleMacrosForNewKcal(newKcal, existing.estimatedKcal, existing);
    // #322 Codex P2: items 도 함께 정정 kcal 로 스케일. macros 만 스케일하고 items 는
    // 원본 유지하면 접기/펼치기 확장 시 합계가 정정된 top-level 과 어긋남.
    // resetAttempts 인 경로 (스케일 기준 없음) 는 items 도 클리어 → backfill 이 재추정.
    const existingItems = sanitizeFoodItemBreakdown(existing.items);
    const scaledItems = scaled.resetAttempts
      ? null
      : scaleItemsForNewKcal(newKcal, existing.estimatedKcal, existingItems);
    const res = await client.foodLog.updateMany({
      where: {
        id,
        estimatedKcal: existing.estimatedKcal,
        proteinG: existing.proteinG,
        carbsG: existing.carbsG,
        fatG: existing.fatG,
        ...(expectedRevision !== undefined ? { updatedAt: expectedRevision } : {}),
      },
      data: {
        estimatedKcal: newKcal,
        proteinG: scaled.proteinG,
        carbsG: scaled.carbsG,
        fatG: scaled.fatG,
        // scaledItems null (resetAttempts) 이면 Prisma.DbNull 로 SQL NULL 저장 →
        // items 클리어 (JS null 은 Prisma JSON JsonNull literal 로 저장돼 semantics 다름).
        // scaledItems === existingItems (no-op) 은 그대로 재저장해도 무해.
        items:
          scaledItems === null
            ? Prisma.DbNull
            : (scaledItems as unknown as Prisma.InputJsonValue),
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
  // Codex P2 (PR #301 19회차): no-op 재제출 (newKcal === oldKcal) 을 oldKcal <= 0 체크 앞으로.
  // 이전엔 zero-kcal 로그 (물·다이어트 콜라 등, macros 도 0) 을 [수정] → 0 그대로 재제출 시
  // oldKcal <= 0 이 먼저 걸려 완전한 nutrition 데이터를 null 로 리셋 + attempts 초기화 → 재
  // backfill 사이클 유발. 값 자체가 안 바뀌면 그대로 유지.
  if (newKcal === oldKcal) {
    return {
      proteinG: oldMacros.proteinG,
      carbsG: oldMacros.carbsG,
      fatG: oldMacros.fatG,
      resetAttempts: false,
    };
  }
  if (oldKcal === null || oldKcal <= 0) {
    // 스케일 기준 없음 → macros null 로 리셋해 backfill 이 재추정.
    return { proteinG: null, carbsG: null, fatG: null, resetAttempts: true };
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
