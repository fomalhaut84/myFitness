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

    // Codex P2 (#283): description 변경만 있고 새 kcal 미제공이면 기존 kcal 은 이전 description
    // 기준이라 stale. null 로 리셋 → cron/backfill 이 새 description 으로 재추정.
    if (data.description !== undefined && data.estimatedKcal === undefined) {
      data.estimatedKcal = null;
    }

    const updated = await prisma.foodLog.update({
      where: { id },
      data,
      select: { id: true, date: true, estimatedKcal: true, description: true, mealType: true },
    });

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
