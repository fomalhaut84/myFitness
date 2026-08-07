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
  /** kcal 업데이트 성공했지만 최종 재계산도 실패한 date 목록 (ISO 문자열). */
  recalcFailedDates: string[];
}

// Codex P2 (rotation): 매 실행 전체 후보 pool 을 이 상한까지 가져와 셔플. limit 이 하위집합.
const ROTATION_POOL_CAP = 500;

export async function runFoodKcalBackfill(
  opts: RunFoodBackfillOptions = {},
): Promise<RunFoodBackfillResult> {
  const limit = opts.limit;
  const olderThanSec = opts.olderThanSec ?? 60;
  const verbose = opts.verbose ?? false;
  const cutoff = new Date(Date.now() - olderThanSec * 1000);

  // Codex P2 (rotation): asc/desc 어느 쪽이든 permanent-fail row 가 매 tick 같은 slot 을 점유.
  // 후보 pool 을 상한까지 fetch → in-memory shuffle → limit 만큼 처리 → 모든 row 가 tick 마다
  // 동등한 확률로 시도됨. 단일 사용자 앱이라 pool cap 500 이면 충분.
  const pool = await prisma.foodLog.findMany({
    where: {
      estimatedKcal: null,
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      description: true,
      mealType: true,
      date: true,
    },
    take: ROTATION_POOL_CAP,
  });
  // Fisher–Yates shuffle (in-place).
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const rows = limit !== undefined ? pool.slice(0, limit) : pool;

  const result: RunFoodBackfillResult = { candidates: rows.length, ok: 0, failed: 0, recalcFailedDates: [] };
  if (opts.dryRun) return result;
  const recalcFailedDates = new Set<string>();

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
      // Codex P2 (race): findMany 이후 사용자가 웹에서 PATCH 로 수동 kcal 설정한 경우
      // 그 값을 stale AI 결과로 덮지 않도록 조건부 update. estimatedKcal 이 여전히 null 인 row 만 갱신.
      const updated = await prisma.foodLog.updateMany({
        where: { id: r.id, estimatedKcal: null },
        data: { estimatedKcal: est.kcal },
      });
      if (updated.count === 0) {
        // 사용자가 그 사이 수동 정정 → skip. 실패 카운트 아님.
        continue;
      }
      try {
        await recalculateCalorieBalance(r.date, undefined, prisma);
      } catch (err) {
        // Codex P2: 재계산 실패해도 kcal update 는 완료된 상태 → 다음 backfill 이 이 row 를 다시
        // 선택하지 않음 → DailySummary 가 stale 로 남을 수 있음. date 를 수집해 loop 끝에 한 번
        // 더 시도. 최종 실패면 result.recalcFailedDates 에 반환하고 error 로그.
        recalcFailedDates.add(r.date.toISOString());
        if (verbose) {
          console.warn(
            `  [food-kcal] recalculate 1차 실패 (log ${r.id}, retry 예정): ${err instanceof Error ? err.message : String(err)}`,
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

  // Codex P2: 1차 recalc 실패한 date 재시도. 동일 date 는 한 번만 호출 (Set 로 중복 제거).
  for (const iso of recalcFailedDates) {
    try {
      await recalculateCalorieBalance(new Date(iso), undefined, prisma);
    } catch (err) {
      result.recalcFailedDates.push(iso);
      console.error(
        `[food-kcal] recalculate 최종 실패 (date ${iso}) — DailySummary stale 가능. 수동 재계산 필요: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
