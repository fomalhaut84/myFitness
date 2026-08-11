import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { estimateNutritionFromText } from "@/lib/nutrition/estimate-nutrition";
import { findRecentSameDescription } from "@/lib/nutrition/repeat-lookup";

const MAX_RETRY = 3;
const RETRY_DELAY_MS = 50;

async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: "Serializable",
      });
    } catch (err) {
      const isSerializationFailure =
        err instanceof Error && err.message.includes("P2034");
      if (!isSerializationFailure || attempt === MAX_RETRY) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error("Serializable retry exhausted");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get("days") ?? "7");
    const since = new Date();
    since.setDate(since.getDate() - (Number.isNaN(days) ? 7 : days));
    since.setHours(0, 0, 0, 0);

    const logs = await prisma.foodLog.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({
      data: logs.map((l) => ({
        ...l,
        date: l.date.toISOString(),
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { description, mealType, date } = body;

    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { error: "description 필드가 필요합니다" },
        { status: 400 }
      );
    }

    // 사전 리뷰 P1-4: date 검증을 AI 호출 전에 해서 잘못된 date 에 15s AI 비용 낭비 방지.
    let foodDate = new Date();
    if (date) {
      foodDate = new Date(date);
      if (isNaN(foodDate.getTime())) {
        return NextResponse.json(
          { error: `유효하지 않은 날짜: ${date}` },
          { status: 400 }
        );
      }
    }

    // #295: repeat lookup 우선 — 최근 30일 동일 description 매치면 AI 스킵.
    // #299 (M14 Phase 2 #3): P/C/F 도 함께 재사용.
    let estimatedKcal: number | null = null;
    let proteinG: number | null = null;
    let carbsG: number | null = null;
    let fatG: number | null = null;
    try {
      const hit = await findRecentSameDescription(description, mealType, foodDate);
      if (hit) {
        estimatedKcal = hit.kcal;
        proteinG = hit.proteinG;
        carbsG = hit.carbsG;
        fatG = hit.fatG;
      }
    } catch (lookupErr) {
      console.warn(
        "[api/food POST] repeat lookup 실패, AI 폴백:",
        lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
      );
    }
    if (estimatedKcal === null) {
      const estimate = await estimateNutritionFromText({ description, mealType });
      estimatedKcal = estimate?.kcal ?? null;
      proteinG = estimate?.proteinG ?? null;
      carbsG = estimate?.carbsG ?? null;
      fatG = estimate?.fatG ?? null;
    }

    // M4-2: FoodLog 생성 + 칼로리 밸런스 재계산을 Serializable 트랜잭션에서 원자화.
    const log = await withSerializableRetry(async (tx) => {
      const created = await tx.foodLog.create({
        data: {
          date: foodDate,
          description,
          estimatedKcal,
          proteinG,
          carbsG,
          fatG,
          mealType: mealType ?? null,
        },
      });
      await recalculateCalorieBalance(foodDate, tx);
      return created;
    });

    return NextResponse.json({
      data: {
        ...log,
        date: log.date.toISOString(),
        createdAt: log.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

