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
// Codex P2 (PR #300): macro AI 추정이 partial null 로 반복되면 매 tick 재호출 낭비.
// 이 횟수 초과 시 kcal 이 채워진 macro-null row 는 permanent 로 스킵.
// weatherAttempts (#269) 패턴 재사용. UI (BackfillNotice terminal vs pending 판정) 도 이 상수 참조.
export const MAX_NUTRITION_ATTEMPTS = 3;

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
  // #299: 조건이 kcal null OR macro null 로 확장.
  // Codex P2 (PR #300): macro-null 은 nutritionAttempts < MAX 인 row 만 (permanent-partial 회피).
  //   kcal null 은 attempts 무관 재시도 (kcal 은 필수).
  const baseWhere = {
    OR: [
      { estimatedKcal: null },
      {
        AND: [
          { estimatedKcal: { not: null } },
          {
            OR: [{ proteinG: null }, { carbsG: null }, { fatG: null }],
          },
          {
            OR: [
              { nutritionAttempts: null },
              { nutritionAttempts: { lt: MAX_NUTRITION_ATTEMPTS } },
            ],
          },
        ],
      },
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
    nutritionAttempts: number | null;
  }
  const rows: Row[] = [];

  if (limit !== undefined) {
    // Codex P2 (PR #300): SQL 도 attempts 상한 반영.
    const pool = await prisma.$queryRaw<Row[]>`
      SELECT id, description, "mealType", date,
             "estimatedKcal", "proteinG", "carbsG", "fatG", "nutritionAttempts"
      FROM "FoodLog"
      WHERE "createdAt" < ${cutoff}
        AND (
          "estimatedKcal" IS NULL
          OR (
            "estimatedKcal" IS NOT NULL
            AND ("proteinG" IS NULL OR "carbsG" IS NULL OR "fatG" IS NULL)
            AND ("nutritionAttempts" IS NULL OR "nutritionAttempts" < ${MAX_NUTRITION_ATTEMPTS})
          )
        )
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
          nutritionAttempts: true,
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
        // Codex P2 (PR #300 5회차): excludeLogId 로 자기 자신 매치 방지 (macro-partial row 자기
        // 스스로가 최상위로 잡혀 null 이 null 을 채우는 무의미 경로 회피).
        const hit = await findRecentSameDescription(
          r.description,
          r.mealType ?? undefined,
          r.date,
          r.id,
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
      // Codex P2 (race, PR #300 4회차): 필드별 null snapshot 매칭으로 concurrent run 방어.
      // 다른 backfill 이 중간에 이 필드를 채웠으면 스킵 (내 estimate 로 덮지 않음).
      // Prisma updateMany 는 한 번에 다중 필드 write 하되 where 에 각 필드의 null 조건 포함.
      // 여러 필드 중 하나만 race 되어도 전체 update 스킵되므로, 필드별 개별 updateMany 로 분리.
      interface FieldWrite {
        field: "estimatedKcal" | "proteinG" | "carbsG" | "fatG";
        value: number;
      }
      const writes: FieldWrite[] = [];
      if (r.estimatedKcal === null && kcal !== null) writes.push({ field: "estimatedKcal", value: kcal });
      if (r.proteinG === null && proteinG !== null) writes.push({ field: "proteinG", value: proteinG });
      if (r.carbsG === null && carbsG !== null) writes.push({ field: "carbsG", value: carbsG });
      if (r.fatG === null && fatG !== null) writes.push({ field: "fatG", value: fatG });

      let anyWritten = false;
      let kcalWritten = false;
      for (const w of writes) {
        const updated = await prisma.foodLog.updateMany({
          where: {
            id: r.id,
            description: r.description,
            mealType: r.mealType,
            [w.field]: null,
          },
          data: { [w.field]: w.value },
        });
        if (updated.count > 0) {
          anyWritten = true;
          if (w.field === "estimatedKcal") kcalWritten = true;
        }
      }
      // Codex P2 (PR #300): AI 를 실제로 호출한 케이스 (stillMissing=true) 는 attempts atomic 증가.
      // Codex P2 (PR #300 5회차): Prisma `{ increment: 1 }` 은 nullable 컬럼이 null 이면 SQL 상
      // `NULL + 1 = NULL` 로 null 유지 → attempts 가 영영 증가 안 함 → 재시도 상한 무효화.
      // COALESCE 로 null→0 후 증가하는 raw SQL 사용.
      if (stillMissing) {
        try {
          await prisma.$executeRaw`
            UPDATE "FoodLog"
            SET "nutritionAttempts" = COALESCE("nutritionAttempts", 0) + 1
            WHERE id = ${r.id}
          `;
        } catch (err) {
          if (verbose) {
            console.warn(
              `  [nutrition] attempts increment 실패 (log ${r.id}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      if (!anyWritten) continue;
      if (kcalWritten) {
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
