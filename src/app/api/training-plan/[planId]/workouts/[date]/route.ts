import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { formatPace } from "@/mcp/tools/running-buckets";
import {
  WORKOUT_PATCH_SCHEMA,
  toWorkoutUpdate,
  normalizeRest,
} from "@/lib/training/workout-editor";
import type { WorkoutType } from "@/app/training-plan/theme";

// M8: 개별 workout 편집. active plan 만 허용.
// PATCH /api/training-plan/[planId]/workouts/[date] with body { type?, distanceKm?, pace?, zone?, intervalDesc?, notes? }

function toUtcDateOnly(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // round-trip 검증
  if (d.toISOString().slice(0, 10) !== ymd) return null;
  return d;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ planId: string; date: string }> }
) {
  try {
    const { planId, date } = await params;
    const dateObj = toUtcDateOnly(date);
    if (!dateObj) {
      return NextResponse.json(
        { error: "유효하지 않은 date (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = WORKOUT_PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "유효하지 않은 입력", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const plan = await prisma.trainingPlan.findUnique({
      where: { id: planId },
      select: { status: true },
    });
    if (!plan) {
      return NextResponse.json(
        { error: "plan 을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    if (plan.status !== "active") {
      return NextResponse.json(
        { error: "archived plan 은 편집할 수 없습니다." },
        { status: 409 }
      );
    }

    const existing = await prisma.trainingWorkout.findUnique({
      where: { planId_date: { planId, date: dateObj } },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "해당 날짜의 workout 이 없습니다." },
        { status: 404 }
      );
    }

    let update;
    try {
      update = toWorkoutUpdate(parsed.data);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }

    const finalType = (parsed.data.type ?? existing.type) as WorkoutType;
    const finalUpdate = normalizeRest(update, finalType);

    const updated = await prisma.trainingWorkout.update({
      where: { planId_date: { planId, date: dateObj } },
      data: finalUpdate,
    });

    return NextResponse.json({
      workout: {
        date: ymdKST(updated.date),
        type: updated.type,
        distanceKm: updated.distanceKm,
        pace:
          updated.paceSecPerKm !== null
            ? formatPace(updated.paceSecPerKm)
            : null,
        zone: updated.zone,
        intervalDesc: updated.intervalDesc,
        notes: updated.notes,
      },
    });
  } catch (error) {
    console.error("[api/training-plan/[planId]/workouts/[date]] PATCH 실패:", error);
    return NextResponse.json(
      { error: "workout 편집 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
