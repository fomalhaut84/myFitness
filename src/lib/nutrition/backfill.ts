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
          // Codex P1 (PR #300 8회차): retained kcal (row 에 이미 kcal 있음) 인 경우 hit.kcal 이
          // 다르면 hit.macros 는 hit.kcal 기준이라 그대로 옮기면 mismatch. AI 브랜치와 동일
          // scaling 정책 적용 (kcal null 이면 hit 통째로, 있으면 macros 를 retained 로 스케일).
          if (kcal === null) {
            kcal = hit.kcal;
            if (proteinG === null) proteinG = hit.proteinG;
            if (carbsG === null) carbsG = hit.carbsG;
            if (fatG === null) fatG = hit.fatG;
          } else {
            const scaled = scaleMacrosForNewKcal(kcal, hit.kcal, {
              proteinG: hit.proteinG,
              carbsG: hit.carbsG,
              fatG: hit.fatG,
            });
            if (proteinG === null) proteinG = scaled.proteinG;
            if (carbsG === null) carbsG = scaled.carbsG;
            if (fatG === null) fatG = scaled.fatG;
          }
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
      // Codex P2 (PR #300 9회차): AI 실패는 attempts 소비 (무한 실패 재호출 방지),
      // AI 성공했으나 race 로 write 진 loser 는 소비 안 함 (실제 write 성공 시에만 소비).
      let aiFailureConsumesAttempt = false;
      if (stillMissing) {
        const est = await estimateNutritionFromText({
          description: r.description,
          mealType: r.mealType ?? undefined,
        });
        if (!est) {
          // AI 실패 — attempts 소비 (kcal-gated 아닌 macros-only bucket 에 한해).
          if (r.estimatedKcal !== null) aiFailureConsumesAttempt = true;
          if (kcal === null) {
            result.failed++;
            continue;
          }
        } else {
          // Codex P1 (PR #300 6회차): 기존 kcal 이 있는 row (legacy or user-corrected) 를
          // 재추정할 때 est.kcal 이 기존 kcal 과 다를 수 있음. 기존 kcal 은 그대로 유지하고
          // est 의 P/C/F 는 est.kcal 기준이라 그대로 쓰면 mismatch. 기존 kcal 에 맞춰 스케일.
          if (kcal === null) {
            kcal = est.kcal;
            if (proteinG === null) proteinG = est.proteinG;
            if (carbsG === null) carbsG = est.carbsG;
            if (fatG === null) fatG = est.fatG;
          } else {
            // kcal 은 기존값 유지. est.macros 를 retained kcal 로 스케일.
            const scaled = scaleMacrosForNewKcal(kcal, est.kcal, {
              proteinG: est.proteinG,
              carbsG: est.carbsG,
              fatG: est.fatG,
            });
            if (proteinG === null) proteinG = scaled.proteinG;
            if (carbsG === null) carbsG = scaled.carbsG;
            if (fatG === null) fatG = scaled.fatG;
          }
        }
      }
      if (kcal === null) {
        // AI 도 kcal 못 채웠으면 스킵 (이미 위에서 failed 증가).
        continue;
      }
      // Codex P2 (race, PR #300 7회차): 원자 tuple write 로 필드 인터리브 방지.
      // Codex P2 (PR #300 8회차): snapshotWhere 를 write 대상 뿐 아니라 fetch 한 모든 nutrition
      // 필드로 확대. retained kcal 이 PATCH 로 바뀌면 우리 macros 는 old kcal 기준이라 mismatch.
      // 어떤 필드든 fetch 값과 달라졌으면 전체 abort → 다음 tick fresh snapshot 으로 재시도.
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
      if (r.estimatedKcal === null && kcal !== null) writeData.estimatedKcal = kcal;
      // Codex P1 (PR #300 10회차): 매크로는 원자 tuple 로만 write. 부분 write 를 허용하면
      // 서로 다른 estimate 가 P/C/F 를 나눠 채워 combined tuple 이 retained kcal 과 non-coherent
      // 인 상태로 row 가 backfill pool 을 벗어남 (모든 필드 non-null → 재선택 안 됨).
      // → 우리 estimate 가 P/C/F 세 값 모두 non-null (retained kcal 로 이미 스케일 완료) 일
      // 때만 macros 전체 덮어쓰기. 기존 non-null 은 다른 estimate 파편 가능성이 있어 신뢰 X.
      const needsSomeMacro =
        r.proteinG === null || r.carbsG === null || r.fatG === null;
      const estGivesCompleteMacros =
        proteinG !== null && carbsG !== null && fatG !== null;
      if (needsSomeMacro && estGivesCompleteMacros) {
        writeData.proteinG = proteinG;
        writeData.carbsG = carbsG;
        writeData.fatG = fatG;
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
      // Codex P2 (PR #300 9회차): concurrent worker 여럿이 같은 snapshot 을 fetch 해도 실제
      // tuple write 는 하나만 성공. loser 는 attempt 소비하면 안 됨 (아무 기여 없이 예산 잠식).
      // → write 실제 성공 (anyWritten) 또는 AI 실패 (aiFailureConsumesAttempt) 시에만 increment.
      const shouldConsumeAttempt = anyWritten || aiFailureConsumesAttempt;
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
