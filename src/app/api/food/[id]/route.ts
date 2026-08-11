// #283 (M14 Phase 1): FoodLog 개별 항목 편집/삭제.
// PATCH { estimatedKcal | description | mealType } — kcal 수정 or 항목 정정
// DELETE — 로그 제거
// 두 경우 모두 해당 날짜 칼로리 밸런스 재계산.

import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";
import { scaleMacrosForNewKcal } from "@/lib/nutrition/scale-macros";

const PATCH_SCHEMA = z.object({
  estimatedKcal: z.number().int().min(0).max(10000).nullable().optional(),
  description: z.string().trim().min(1).max(500).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable().optional(),
});

interface Params {
  params: Promise<{ id: string }>;
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025"
  );
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "유효하지 않은 입력", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "변경할 필드가 없습니다" },
        { status: 400 },
      );
    }

    // Codex P2 (PR #300 4회차): 우선순위 정리.
    // 1) description/mealType 변경이 포함되면 항상 macros 를 클리어 (kcal 유무 무관).
    // 2) 그 외에 kcal 만 정정 → macros 를 새 kcal 비율로 스케일.
    const updateData: Record<string, unknown> = { ...data };
    const descOrMealChanged =
      data.description !== undefined || data.mealType !== undefined;
    let updated: {
      id: string;
      date: Date;
      estimatedKcal: number | null;
      description: string;
      mealType: string | null;
    };
    if (descOrMealChanged) {
      if (data.estimatedKcal === undefined) updateData.estimatedKcal = null;
      updateData.proteinG = null;
      updateData.carbsG = null;
      updateData.fatG = null;
      updateData.nutritionAttempts = null;
      updated = await prisma.foodLog.update({
        where: { id },
        data: updateData,
        select: { id: true, date: true, estimatedKcal: true, description: true, mealType: true },
      });
    } else if (data.estimatedKcal !== undefined) {
      // Codex P2 (PR #300 7회차): fetch → scale → write 사이 backfill 이 macros 를 채운 경우
      // stale null 로 stomp 방지. 스냅샷 predicate + 재시도 (최대 3회) 로 lost-update 회피.
      const MAX_ATTEMPT = 3;
      let attempt = 0;
      let done: typeof updated | null = null;
      let notFound = false;
      while (attempt < MAX_ATTEMPT && !done) {
        attempt++;
        const existing = await prisma.foodLog.findUnique({
          where: { id },
          select: { estimatedKcal: true, proteinG: true, carbsG: true, fatG: true },
        });
        if (!existing) {
          notFound = true;
          break;
        }
        const scaled = scaleMacrosForNewKcal(
          data.estimatedKcal,
          existing.estimatedKcal,
          existing,
        );
        const attemptData = {
          ...updateData,
          proteinG: scaled.proteinG,
          carbsG: scaled.carbsG,
          fatG: scaled.fatG,
          ...(scaled.resetAttempts ? { nutritionAttempts: null } : {}),
        };
        const res = await prisma.foodLog.updateMany({
          where: {
            id,
            estimatedKcal: existing.estimatedKcal,
            proteinG: existing.proteinG,
            carbsG: existing.carbsG,
            fatG: existing.fatG,
          },
          data: attemptData,
        });
        if (res.count > 0) {
          const fetched = await prisma.foodLog.findUnique({
            where: { id },
            select: { id: true, date: true, estimatedKcal: true, description: true, mealType: true },
          });
          if (fetched) done = fetched;
        }
      }
      if (notFound || !done) {
        if (notFound) {
          return NextResponse.json({ error: "로그를 찾을 수 없습니다" }, { status: 404 });
        }
        return NextResponse.json(
          { error: "동시 수정 감지, 다시 시도해주세요" },
          { status: 409 },
        );
      }
      updated = done;
    } else {
      updated = await prisma.foodLog.update({
        where: { id },
        data: updateData,
        select: { id: true, date: true, estimatedKcal: true, description: true, mealType: true },
      });
    }

    // 재계산 실패해도 update 자체는 성공 유지 (200 응답).
    // Codex P2 (#283): 실패 시 stale-recalc 큐에 mark → cron 이 이어받아 재시도.
    // 그렇지 않으면 historical 로그 (Garmin cron 2일 창 밖) 는 DailySummary 가 영영 stale.
    try {
      await recalculateCalorieBalance(updated.date, undefined, prisma);
    } catch (err) {
      console.warn(
        `[api/food/${id}] 재계산 실패 (큐에 mark):`,
        err instanceof Error ? err.message : String(err),
      );
      try {
        await markStaleRecalcDate(updated.date);
      } catch (mErr) {
        console.error(
          `[api/food/${id}] stale-recalc 큐 기록 실패:`,
          mErr instanceof Error ? mErr.message : String(mErr),
        );
      }
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    if (isNotFound(error)) {
      return NextResponse.json({ error: "로그를 찾을 수 없습니다" }, { status: 404 });
    }
    console.error(`[api/food/${id}] PATCH error:`, error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Params) {
  const { id } = await ctx.params;
  try {
    const deleted = await prisma.foodLog.delete({
      where: { id },
      select: { date: true },
    });

    // Codex P2 (#283): DELETE 도 동일하게 stale-recalc 큐 mark → cron 재시도.
    try {
      await recalculateCalorieBalance(deleted.date, undefined, prisma);
    } catch (err) {
      console.warn(
        `[api/food/${id}] 재계산 실패 (큐에 mark):`,
        err instanceof Error ? err.message : String(err),
      );
      try {
        await markStaleRecalcDate(deleted.date);
      } catch (mErr) {
        console.error(
          `[api/food/${id}] stale-recalc 큐 기록 실패:`,
          mErr instanceof Error ? mErr.message : String(mErr),
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isNotFound(error)) {
      return NextResponse.json({ error: "로그를 찾을 수 없습니다" }, { status: 404 });
    }
    console.error(`[api/food/${id}] DELETE error:`, error);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
