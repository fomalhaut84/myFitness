import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { estimateNutritionFromText } from "@/lib/nutrition/estimate-nutrition";
import { findRecentSameDescription } from "@/lib/nutrition/repeat-lookup";
import { scaleMacrosForNewKcal } from "@/lib/nutrition/scale-macros";

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
    let hitKcal: number | null = null;
    try {
      // Codex P2 (PR #301 27회차): client 가 mealType 없이 보내면 undefined → 저장 시
      // `mealType ?? null` 로 null 저장. lookup 은 null-meal 클래스 매치되려면 null 로 전달해야
      // 함 (undefined 는 "no preference" 로 취급되어 null-meal 을 우선순위에서 배제).
      const hit = await findRecentSameDescription(description, mealType ?? null, foodDate);
      if (hit) {
        hitKcal = hit.kcal;
        estimatedKcal = hit.kcal;
        // Codex P2 (PR #300 15회차): complete tuple 만 채택. lookup 이 complete 우선하지만
        // window 내에 complete 매치가 없으면 partial 최신을 반환할 수 있음 → 부분값은 취하지 않고
        // AI 로 채움 (아래).
        if (hit.proteinG !== null && hit.carbsG !== null && hit.fatG !== null) {
          proteinG = hit.proteinG;
          carbsG = hit.carbsG;
          fatG = hit.fatG;
        }
      }
    } catch (lookupErr) {
      console.warn(
        "[api/food POST] repeat lookup 실패, AI 폴백:",
        lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
      );
    }
    // Codex P2 (PR #300 15회차): estimatedKcal null 이거나 macros 미완이면 AI 호출.
    // hit.kcal 이 있는데 macros 만 부족한 경우: AI 로 macros 채우고 hit.kcal 에 맞춰 스케일
    // (consistency 유지 · backfill retry 상한에 의존 안 함).
    const macrosIncomplete = proteinG === null || carbsG === null || fatG === null;
    if (estimatedKcal === null || macrosIncomplete) {
      const estimate = await estimateNutritionFromText({ description, mealType });
      if (estimate) {
        if (estimatedKcal === null) {
          estimatedKcal = estimate.kcal;
          proteinG = estimate.proteinG;
          carbsG = estimate.carbsG;
          fatG = estimate.fatG;
        } else {
          // hit.kcal 보존, AI macros 를 hit.kcal 로 스케일해 채움.
          const scaled = scaleMacrosForNewKcal(hitKcal, estimate.kcal, {
            proteinG: estimate.proteinG,
            carbsG: estimate.carbsG,
            fatG: estimate.fatG,
          });
          proteinG = scaled.proteinG;
          carbsG = scaled.carbsG;
          fatG = scaled.fatG;
        }
      }
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

