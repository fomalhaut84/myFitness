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
import { applyKcalCorrection } from "@/lib/nutrition/scale-macros";

const PATCH_SCHEMA = z.object({
  estimatedKcal: z.number().int().min(0).max(10000).nullable().optional(),
  description: z.string().trim().min(1).max(500).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable().optional(),
  // Codex P2 (PR #313 12회차): client 가 kcal 저장 시 draft 를 뽑은 시점의 row updatedAt 을
  // 함께 전송해 stale-vs-fresh 판정. server 는 저장 직전 fetch 한 updatedAt 과 비교, 다르면
  // 409. description 값 비교는 A→B→A restore 커버 못 함 — monotonic revision (updatedAt)
  // 로 근본 방어. ISO string 으로 직렬화.
  expectedRevision: z.string().datetime().optional(),
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
    // Codex P2 (PR #301 24회차): field 존재만으로 changed 판정 시 client 가 full-form patch
    // (description/mealType 원본값 포함, kcal 만 변경) 를 보낼 때 unchanged 값도 macros clear
    // 를 유발 → row 가 backfill 큐로 재진입 → attempts 상한 초과 시 permanent 부분 미측정.
    // stored row 와 실제 값 비교로 판단.
    const existing = await prisma.foodLog.findUnique({
      where: { id },
      select: { description: true, mealType: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "로그를 찾을 수 없습니다" }, { status: 404 });
    }
    const descChanged =
      data.description !== undefined && data.description !== existing.description;
    const mealChanged =
      data.mealType !== undefined && data.mealType !== existing.mealType;
    const descOrMealChanged = descChanged || mealChanged;
    // Codex P2 (PR #301 25회차): stale-read race 방지 — classified as no-op 인 필드는
    // 최종 write payload 에서 제거. 이전 approach 는 existing 을 읽고 판정한 뒤 여전히
    // description/mealType 을 payload 에 포함시켜 update → 그 사이 다른 PATCH 가 description
    // 을 Y 로 바꾸고 macros 도 populate 됐다면 A 의 stale X 로 덮어써서 macros mismatch 발생.
    // Codex P2 (PR #313 10회차): expectedRevision 은 스냅샷 매칭용 control metadata —
    // Prisma FoodLog 컬럼 아님. spread 시 update.data 에 포함되면 500 (unknown field).
    // 별도 변수로 뽑아 payload 에서 제외.
    const { expectedRevision, ...dataForWrite } = data;
    const expectedRevisionDate =
      expectedRevision !== undefined ? new Date(expectedRevision) : undefined;
    const updateData: Record<string, unknown> = { ...dataForWrite };
    if (data.description !== undefined && !descChanged) delete updateData.description;
    if (data.mealType !== undefined && !mealChanged) delete updateData.mealType;
    let updated: {
      id: string;
      date: Date;
      estimatedKcal: number | null;
      description: string;
      mealType: string | null;
    };
    // 모든 필드가 no-op (오직 unchanged desc/mealType 만 submit) 이면 DB 건드리지 않고 기존 반환.
    if (Object.keys(updateData).length === 0) {
      const existingFull = await prisma.foodLog.findUnique({
        where: { id },
        select: { id: true, date: true, estimatedKcal: true, description: true, mealType: true },
      });
      if (!existingFull) {
        return NextResponse.json({ error: "로그를 찾을 수 없습니다" }, { status: 404 });
      }
      return NextResponse.json({ data: existingFull });
    }
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
      // Codex P2 (PR #300 7회차/8회차): kcal 만 정정 concurrency-safe helper 사용.
      // 새 kcal 이 null 이면 macros/attempts 모두 null 리셋.
      if (data.estimatedKcal === null) {
        updateData.proteinG = null;
        updateData.carbsG = null;
        updateData.fatG = null;
        updateData.nutritionAttempts = null;
        // Codex P2 (PR #313 11/12회차): null 경로도 expectedRevision snapshot 매칭. 이전엔
        // helper 를 안 거쳐 stale draft (예: kcal editor 오픈 이후 다른 writer 가 row 를 변경
        // 하고 backfill 로 새 kcal/macros 저장) 로 blank 저장 시 새 row 의 macros 를 파괴.
        // updateMany + where.updatedAt snapshot → count 0 이면 409 (monotonic revision 이라
        // A→B→A restore 도 안전).
        if (expectedRevisionDate !== undefined) {
          const res = await prisma.foodLog.updateMany({
            where: { id, updatedAt: expectedRevisionDate },
            data: updateData,
          });
          if (res.count === 0) {
            return NextResponse.json(
              {
                error:
                  "로그가 다른 경로로 변경되었습니다. 새로고침 후 다시 시도해주세요.",
              },
              { status: 409 },
            );
          }
          const fetched = await prisma.foodLog.findUnique({
            where: { id },
            select: { id: true, date: true, estimatedKcal: true, description: true, mealType: true },
          });
          if (!fetched) {
            return NextResponse.json({ error: "로그를 찾을 수 없습니다" }, { status: 404 });
          }
          updated = fetched;
        } else {
          updated = await prisma.foodLog.update({
            where: { id },
            data: updateData,
            select: { id: true, date: true, estimatedKcal: true, description: true, mealType: true },
          });
        }
      } else {
        const correction = await applyKcalCorrection(
          prisma,
          id,
          data.estimatedKcal,
          expectedRevisionDate,
        );
        if (!correction.ok) {
          if (correction.reason === "not-found") {
            return NextResponse.json({ error: "로그를 찾을 수 없습니다" }, { status: 404 });
          }
          if (correction.reason === "stale") {
            return NextResponse.json(
              {
                error:
                  "로그가 다른 경로로 변경되었습니다. 새로고침 후 다시 시도해주세요.",
              },
              { status: 409 },
            );
          }
          return NextResponse.json(
            { error: "동시 수정 감지, 다시 시도해주세요" },
            { status: 409 },
          );
        }
        const fetched = await prisma.foodLog.findUnique({
          where: { id },
          select: { id: true, date: true, estimatedKcal: true, description: true, mealType: true },
        });
        if (!fetched) {
          return NextResponse.json({ error: "로그를 찾을 수 없습니다" }, { status: 404 });
        }
        updated = fetched;
      }
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
