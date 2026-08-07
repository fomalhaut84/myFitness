// #283 후속 (Codex P1): transient AI 실패로 estimatedKcal null 남은 FoodLog 재추정.
// - script (scripts/backfill-food-kcal.ts) + cron 훅 (syncAll 후) 에서 재사용.
// - 봇의 초기 AI 호출과 race 회피 위해 createdAt 이 최소 60s 지난 로그만 대상.
// - 각 log 마다 AI 호출 (max 15s). 실패 시 계속 null → 다음 tick 재시도.

import prisma from "@/lib/prisma";
import { estimateKcalFromText } from "@/lib/nutrition/estimate-kcal";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";

export interface RunFoodBackfillOptions {
  /** 1회 실행 처리 상한. 미지정 시 전량. */
  limit?: number;
  /** createdAt 이 이 초 이상 지난 log 만. 기본 60. */
  olderThanSec?: number;
  /** 진행 로그 출력 여부. */
  verbose?: boolean;
  /** true 면 update 없이 대상 카운트만. */
  dryRun?: boolean;
}

export interface RunFoodBackfillResult {
  candidates: number;
  ok: number;
  failed: number;
}

export async function runFoodKcalBackfill(
  opts: RunFoodBackfillOptions = {},
): Promise<RunFoodBackfillResult> {
  const limit = opts.limit;
  const olderThanSec = opts.olderThanSec ?? 60;
  const verbose = opts.verbose ?? false;
  const cutoff = new Date(Date.now() - olderThanSec * 1000);

  const rows = await prisma.foodLog.findMany({
    where: {
      estimatedKcal: null,
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      description: true,
      mealType: true,
      date: true,
    },
    ...(limit !== undefined ? { take: limit } : {}),
  });

  const result: RunFoodBackfillResult = { candidates: rows.length, ok: 0, failed: 0 };
  if (opts.dryRun) return result;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const est = await estimateKcalFromText({
        description: r.description,
        mealType: r.mealType ?? undefined,
      });
      if (!est) {
        result.failed++;
        continue;
      }
      await prisma.foodLog.update({
        where: { id: r.id },
        data: { estimatedKcal: est.kcal },
      });
      try {
        await recalculateCalorieBalance(r.date, undefined, prisma);
      } catch (err) {
        // 재계산 실패는 카운트에만 반영 안 함 — 다음 사용자 조작에서 다시 재계산됨.
        if (verbose) {
          console.warn(
            `  [food-kcal] recalculate 실패 (log ${r.id}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      result.ok++;
    } catch (err) {
      result.failed++;
      if (verbose) {
        console.warn(
          `  [food-kcal] estimate 실패 (log ${r.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return result;
}
