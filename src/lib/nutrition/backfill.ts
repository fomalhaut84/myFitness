// #283 후속 (Codex P1): transient AI 실패로 estimatedKcal null 남은 FoodLog 재추정.
// - script (scripts/backfill-food-kcal.ts) + cron 훅 (syncAll 후) 에서 재사용.
// - 봇의 초기 AI 호출과 race 회피 위해 createdAt 이 최소 60s 지난 로그만 대상.
// - 각 log 마다 AI 호출 (max 15s). 실패 시 계속 null → 다음 tick 재시도.

import prisma from "@/lib/prisma";
import { estimateNutritionFromText } from "@/lib/nutrition/estimate-nutrition";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";
import { findRecentSameDescription } from "@/lib/nutrition/repeat-lookup";

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

  // Codex P2:
  //  - limit 지정 (cron/스크립트 배치): pool cap 까지 fetch → in-memory shuffle → limit 하위집합.
  //  - limit 미지정 (전량 backfill): cursor-based 페이지네이션.
  // #299 (M14 Phase 2 #3): 조건이 kcal null OR macro null 로 확장 — 매크로 도입 이전의 kcal-only
  // row 도 재추정 대상. 이미 채워진 필드는 update 조건절로 보존.
  const baseWhere = {
    OR: [
      { estimatedKcal: null },
      { proteinG: null },
      { carbsG: null },
      { fatG: null },
    ],
    createdAt: { lt: cutoff },
  };

  interface Row {
    id: string;
    description: string;
    mealType: string | null;
    date: Date;
    estimatedKcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  }
  const rows: Row[] = [];

  if (limit !== undefined) {
    const pool = await prisma.$queryRaw<Row[]>`
      SELECT id, description, "mealType", date,
             "estimatedKcal", "proteinG", "carbsG", "fatG"
      FROM "FoodLog"
      WHERE ("estimatedKcal" IS NULL OR "proteinG" IS NULL OR "carbsG" IS NULL OR "fatG" IS NULL)
        AND "createdAt" < ${cutoff}
      ORDER BY random()
      LIMIT ${ROTATION_POOL_CAP}
    `;
    rows.push(...pool.slice(0, limit));
  } else {
    const PAGE = 100;
    let cursorId: string | undefined = undefined;
    for (;;) {
      const page: Row[] = await prisma.foodLog.findMany({
        where: baseWhere,
        orderBy: { id: "asc" },
        select: {
          id: true,
          description: true,
          mealType: true,
          date: true,
          estimatedKcal: true,
          proteinG: true,
          carbsG: true,
          fatG: true,
        },
        take: PAGE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      rows.push(...page);
      cursorId = page[page.length - 1].id;
      if (page.length < PAGE) break;
    }
  }

  const result: RunFoodBackfillResult = { candidates: rows.length, ok: 0, failed: 0, recalcFailedDates: [] };
  if (opts.dryRun) return result;
  const recalcFailedDates = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      // #295 (M14 Phase 2 #2): repeat lookup — 최근 30일 내 동일 description 로그가
      // 있으면 그 kcal + P/C/F 재사용. AI 호출/rate limit 회피 + 일관성.
      let kcal = r.estimatedKcal;
      let proteinG = r.proteinG;
      let carbsG = r.carbsG;
      let fatG = r.fatG;
      try {
        const hit = await findRecentSameDescription(
          r.description,
          r.mealType ?? undefined,
          r.date,
        );
        if (hit) {
          if (kcal === null) kcal = hit.kcal;
          if (proteinG === null) proteinG = hit.proteinG;
          if (carbsG === null) carbsG = hit.carbsG;
          if (fatG === null) fatG = hit.fatG;
        }
      } catch (lookupErr) {
        if (verbose) {
          console.warn(
            `  [nutrition] repeat lookup 실패 (log ${r.id}), AI fallback: ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`,
          );
        }
      }
      // 여전히 null 필드가 남아 있으면 AI 로 채우기.
      const stillMissing =
        kcal === null || proteinG === null || carbsG === null || fatG === null;
      if (stillMissing) {
        const est = await estimateNutritionFromText({
          description: r.description,
          mealType: r.mealType ?? undefined,
        });
        if (!est) {
          // kcal 조차 없으면 실패, 있으면 이후 update 시도 (부분 성공).
          if (kcal === null) {
            result.failed++;
            continue;
          }
        } else {
          if (kcal === null) kcal = est.kcal;
          if (proteinG === null) proteinG = est.proteinG;
          if (carbsG === null) carbsG = est.carbsG;
          if (fatG === null) fatG = est.fatG;
        }
      }
      if (kcal === null) {
        // AI 도 kcal 못 채웠으면 스킵 (이미 위에서 failed 증가).
        continue;
      }
      // Codex P2 (race): 이미 채워진 필드는 조건부로 보호. null 인 필드만 update, 기존 non-null
      // 은 그대로. description/mealType 스냅샷 매칭으로 stale 값 방지.
      const data: {
        estimatedKcal?: number;
        proteinG?: number | null;
        carbsG?: number | null;
        fatG?: number | null;
      } = {};
      if (r.estimatedKcal === null && kcal !== null) data.estimatedKcal = kcal;
      if (r.proteinG === null) data.proteinG = proteinG;
      if (r.carbsG === null) data.carbsG = carbsG;
      if (r.fatG === null) data.fatG = fatG;
      if (Object.keys(data).length === 0) continue;
      const updated = await prisma.foodLog.updateMany({
        where: {
          id: r.id,
          description: r.description,
          mealType: r.mealType,
          // race: kcal 이 null 이었던 row 만 kcal update (다른 필드 update 는 필드별 조건은 아니지만
          // description/mealType 매칭으로 대체 방어).
          ...(data.estimatedKcal !== undefined ? { estimatedKcal: null } : {}),
        },
        data,
      });
      if (updated.count === 0) {
        continue;
      }
      if (data.estimatedKcal !== undefined) {
        try {
          await recalculateCalorieBalance(r.date, undefined, prisma);
        } catch (err) {
          recalcFailedDates.add(r.date.toISOString());
          if (verbose) {
            console.warn(
              `  [nutrition] recalculate 1차 실패 (log ${r.id}, retry 예정): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      result.ok++;
    } catch (err) {
      result.failed++;
      if (verbose) {
        console.warn(
          `  [nutrition] estimate 실패 (log ${r.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Codex P2: 1차 recalc 실패한 date 재시도. 동일 date 는 한 번만 호출 (Set 로 중복 제거).
  // 최종 실패는 stale-recalc 큐에 mark 해 cron 이 이어받게 함.
  for (const iso of recalcFailedDates) {
    try {
      await recalculateCalorieBalance(new Date(iso), undefined, prisma);
    } catch (err) {
      result.recalcFailedDates.push(iso);
      console.error(
        `[food-kcal] recalculate 최종 실패 (date ${iso}) — DailySummary stale 가능: ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        await markStaleRecalcDate(new Date(iso));
      } catch (mErr) {
        console.error(
          `[food-kcal] stale-recalc 큐 기록 실패: ${mErr instanceof Error ? mErr.message : String(mErr)}`,
        );
      }
    }
  }

  return result;
}
