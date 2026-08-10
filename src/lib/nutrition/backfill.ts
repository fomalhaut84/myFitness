// #283 후속 (Codex P1): transient AI 실패로 estimatedKcal null 남은 FoodLog 재추정.
// - script (scripts/backfill-food-kcal.ts) + cron 훅 (syncAll 후) 에서 재사용.
// - 봇의 초기 AI 호출과 race 회피 위해 createdAt 이 최소 60s 지난 로그만 대상.
// - 각 log 마다 AI 호출 (max 15s). 실패 시 계속 null → 다음 tick 재시도.

import prisma from "@/lib/prisma";
import { estimateKcalFromText } from "@/lib/nutrition/estimate-kcal";
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
  //    permanent-fail row 가 slot 점유하는 문제를 로테이션으로 해소.
  //  - limit 미지정 (전량 backfill): shuffle + cap 이면 500 밖 row 는 영영 미도달. 커서 페이지네이션
  //    으로 모든 row 를 asc 순회.
  const baseWhere = {
    estimatedKcal: null,
    createdAt: { lt: cutoff },
  } as const;

  const rows: Array<{
    id: string;
    description: string;
    mealType: string | null;
    date: Date;
  }> = [];

  if (limit !== undefined) {
    // Codex P2 (#283 후속): Postgres 에서 전체 null pool 을 대상으로 random() sampling.
    // 이전 orderBy createdAt desc + JS shuffle 은 newest ROTATION_POOL_CAP (500) 안에서만
    // rotation → 그 window 밖 오래된 row 는 영영 미도달. random() 로 매 tick 전체 backlog 에서
    // pool 을 뽑아 permanent-fail 이 어디에 있든 다른 row 가 순환 진입 가능.
    const pool = await prisma.$queryRaw<
      Array<{ id: string; description: string; mealType: string | null; date: Date }>
    >`
      SELECT id, description, "mealType", date
      FROM "FoodLog"
      WHERE "estimatedKcal" IS NULL AND "createdAt" < ${cutoff}
      ORDER BY random()
      LIMIT ${ROTATION_POOL_CAP}
    `;
    rows.push(...pool.slice(0, limit));
  } else {
    // 전량 처리: cursor-based 페이지네이션 (id asc). 성공하면 결과셋에서 빠지지만 남은 row 는
    // cursor 이후로 계속 진행되므로 이번 실행 안에서 놓치지 않음.
    const PAGE = 100;
    let cursorId: string | undefined = undefined;
    for (;;) {
      const page: Array<{
        id: string;
        description: string;
        mealType: string | null;
        date: Date;
      }> = await prisma.foodLog.findMany({
        where: baseWhere,
        orderBy: { id: "asc" },
        select: { id: true, description: true, mealType: true, date: true },
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
      // #295 (M14 Phase 2 #2): AI 호출 전 repeat lookup — 최근 30일 내 동일 description 로그가
      // 있으면 그 kcal 재사용. AI 호출/rate limit 회피 + 일관성.
      let kcal: number | null = null;
      try {
        const hit = await findRecentSameDescription(
          r.description,
          r.mealType ?? undefined,
        );
        if (hit) kcal = hit.kcal;
      } catch (lookupErr) {
        if (verbose) {
          console.warn(
            `  [food-kcal] repeat lookup 실패 (log ${r.id}), AI fallback: ${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`,
          );
        }
      }
      if (kcal === null) {
        const est = await estimateKcalFromText({
          description: r.description,
          mealType: r.mealType ?? undefined,
        });
        if (!est) {
          result.failed++;
          continue;
        }
        kcal = est.kcal;
      }
      // Codex P2 (race): findMany 이후 사용자가 웹에서 PATCH 로 수동 kcal 설정한 경우
      // 그 값을 stale 결과로 덮지 않도록 조건부 update. estimatedKcal 이 여전히 null 인 row 만 갱신.
      // Codex P2 (description race): PATCH 로 description 이 바뀌면서 kcal 도 null 로 리셋된 케이스
      // → estimatedKcal 조건만으로는 통과. description/mealType 스냅샷도 검사해 old-desc 기반
      // 결과를 new-desc 로 덮지 않도록 방어.
      const updated = await prisma.foodLog.updateMany({
        where: {
          id: r.id,
          estimatedKcal: null,
          description: r.description,
          mealType: r.mealType,
        },
        data: { estimatedKcal: kcal },
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
