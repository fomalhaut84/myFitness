// #283 후속 (Codex P1): transient AI 실패로 estimatedKcal null 남은 FoodLog 재추정.
// - script (scripts/backfill-food-kcal.ts) + cron 훅 (syncAll 후) 에서 재사용.
// - 봇의 초기 AI 호출과 race 회피 위해 createdAt 이 최소 60s 지난 로그만 대상.
// - 각 log 마다 AI 호출 (max 15s). 실패 시 계속 null → 다음 tick 재시도.

import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { estimateNutritionFromText } from "@/lib/nutrition/estimate-nutrition";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";
import { findRecentSameDescription } from "@/lib/nutrition/repeat-lookup";
import { scaleMacrosForNewKcal } from "@/lib/nutrition/scale-macros";

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
      // Codex P1 (PR #300 11회차): kcal 결정과 매크로 tuple 결정을 완전히 분리.
      // - kcal 은 null 이면 hit 또는 est 로부터 취득 가능.
      // - 매크로는 반드시 단일 source (hit 만 or est 만) 에서 완전 tuple (P/C/F 셋 다) 로만 채택.
      //   여러 source 를 병합하면 combined tuple 이 retained kcal 과 non-coherent.
      let kcal = r.estimatedKcal;
      let macroTuple: { proteinG: number; carbsG: number; fatG: number } | null = null;

      // Helper: source (hit 또는 est) 의 macros 를 target kcal 로 스케일해 완전 tuple 반환.
      const tupleFromSource = (
        srcKcal: number,
        srcP: number | null,
        srcC: number | null,
        srcF: number | null,
        targetKcal: number,
      ): { proteinG: number; carbsG: number; fatG: number } | null => {
        if (srcP === null || srcC === null || srcF === null) return null;
        if (targetKcal === srcKcal) return { proteinG: srcP, carbsG: srcC, fatG: srcF };
        const scaled = scaleMacrosForNewKcal(targetKcal, srcKcal, {
          proteinG: srcP,
          carbsG: srcC,
          fatG: srcF,
        });
        if (scaled.proteinG === null || scaled.carbsG === null || scaled.fatG === null) return null;
        return {
          proteinG: scaled.proteinG,
          carbsG: scaled.carbsG,
          fatG: scaled.fatG,
        };
      };

      // 1) Repeat lookup
      try {
        // Codex P2 (PR #301 27회차): r.mealType 이 null (null-meal 로그) 이면 그대로 null 전달.
        // 이전엔 `?? undefined` 로 변환해 "no preference" 취급 → null-meal same-meal 우선순위 상실.
        const hit = await findRecentSameDescription(
          r.description,
          r.mealType,
          r.date,
          r.id,
        );
        if (hit) {
          if (kcal === null) kcal = hit.kcal;
          // hit 이 완전 macros 이면 이번 write 후보. 부분이면 스킵 (다른 source 시도).
          if (kcal !== null) {
            macroTuple = tupleFromSource(hit.kcal, hit.proteinG, hit.carbsG, hit.fatG, kcal);
          }
        }
      } catch (lookupErr) {
        if (verbose) {
          console.warn(
            `  [nutrition] repeat lookup 실패 (log ${r.id}), AI fallback: ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`,
          );
        }
      }

      const needsSomeMacro =
        r.proteinG === null || r.carbsG === null || r.fatG === null;
      // Codex P2 (PR #300 9회차): AI 실패는 attempts 소비, race loser 는 소비 안 함.
      // Codex P2 (PR #300 11회차): AI 가 valid 하지만 partial 매크로 반환 → 원자 write 불가 →
      // 무한 재호출 방지 위해 소비. macros-only bucket 에 한함.
      let aiFailureConsumesAttempt = false;
      let aiPartialConsumesAttempt = false;
      const stillNeedsAI = kcal === null || (needsSomeMacro && macroTuple === null);
      if (stillNeedsAI) {
        const est = await estimateNutritionFromText({
          description: r.description,
          mealType: r.mealType ?? undefined,
        });
        if (!est) {
          if (r.estimatedKcal !== null) aiFailureConsumesAttempt = true;
          if (kcal === null) {
            result.failed++;
            continue;
          }
        } else {
          if (kcal === null) kcal = est.kcal;
          if (needsSomeMacro && macroTuple === null && kcal !== null) {
            macroTuple = tupleFromSource(est.kcal, est.proteinG, est.carbsG, est.fatG, kcal);
            if (macroTuple === null && r.estimatedKcal !== null) {
              // AI valid but partial → macros-only bucket 에서 무한 재호출 방지.
              aiPartialConsumesAttempt = true;
            }
          }
        }
      }
      if (kcal === null) continue;

      // Codex P2 (race, PR #300 7회차): 원자 tuple write. snapshotWhere 는 모든 nutrition 필드
      // 포함 → 어떤 필드든 fetch 값과 다르면 abort, 다음 tick fresh snapshot 재시도.
      const writeData: {
        estimatedKcal?: number;
        proteinG?: number | null;
        carbsG?: number | null;
        fatG?: number | null;
      } = {};
      const snapshotWhere = {
        estimatedKcal: r.estimatedKcal,
        proteinG: r.proteinG,
        carbsG: r.carbsG,
        fatG: r.fatG,
      };
      if (r.estimatedKcal === null) writeData.estimatedKcal = kcal;
      // Codex P1 (PR #300 11회차): macroTuple 은 이미 단일 source 에서 완전 tuple + retained kcal
      // 로 스케일 완료. 부분 파편 병합 위험 없음. 기존 non-null macro 도 함께 덮어써 파편 정리.
      if (needsSomeMacro && macroTuple !== null) {
        writeData.proteinG = macroTuple.proteinG;
        writeData.carbsG = macroTuple.carbsG;
        writeData.fatG = macroTuple.fatG;
      }

      let anyWritten = false;
      let kcalWritten = false;
      if (Object.keys(writeData).length > 0) {
        const updated = await prisma.foodLog.updateMany({
          where: {
            id: r.id,
            description: r.description,
            mealType: r.mealType,
            ...snapshotWhere,
          },
          data: writeData,
        });
        if (updated.count > 0) {
          anyWritten = true;
          kcalWritten = writeData.estimatedKcal !== undefined;
        }
      }
      // Codex P2 (PR #300 5회차): Prisma `{ increment: 1 }` 은 nullable 컬럼 null 값에서 SQL 상
      // `NULL + 1 = NULL` 로 null 유지 → attempts 가 영영 증가 안 함 → 재시도 상한 무효화.
      // COALESCE 로 null→0 후 증가하는 raw SQL 사용.
      // Codex P2 (PR #300 7회차): description/mealType 스냅샷 조건 추가 — PATCH 로 description
      // 이 바뀌면서 attempts 를 리셋한 새 row 의 재시도 예산을 stale worker 가 소진하는 것 방지.
      // Codex P2 (PR #300 9회차/11회차): race loser 는 소비 X. 소비 조건:
      //  - anyWritten: 실제 write 성공
      //  - aiFailureConsumesAttempt: AI 자체 실패 (null)
      //  - aiPartialConsumesAttempt: AI 는 성공했으나 partial 매크로만 반환 → 원자 write 불가
      const shouldConsumeAttempt =
        anyWritten || aiFailureConsumesAttempt || aiPartialConsumesAttempt;
      if (shouldConsumeAttempt) {
        try {
          const mealCond =
            r.mealType === null
              ? Prisma.sql`"mealType" IS NULL`
              : Prisma.sql`"mealType" = ${r.mealType}`;
          await prisma.$executeRaw`
            UPDATE "FoodLog"
            SET "nutritionAttempts" = COALESCE("nutritionAttempts", 0) + 1
            WHERE id = ${r.id}
              AND "description" = ${r.description}
              AND ${mealCond}
          `;
        } catch (err) {
          if (verbose) {
            console.warn(
              `  [nutrition] attempts increment 실패 (log ${r.id}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      if (!anyWritten) {
        // Codex P2 (PR #300 14회차): macro-only 후보에서 AI 가 실패/부분값만 반환하면 attempts
        // 는 소비됐지만 write 는 없음 → 이전에는 continue 만 하고 ok/failed 둘 다 증가 안 해서
        // 3회 실패 후 terminal 이 되어도 cron/스크립트가 "성공 0, 실패 0" 으로 표시.
        // 소비된 시도는 실패 카운트로 반영해 재시도 상한 소진을 감지 가능하게.
        if (shouldConsumeAttempt) result.failed++;
        continue;
      }
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
