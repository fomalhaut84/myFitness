import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";

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

    // AI 칼로리 추정 (간단한 추정 — 향후 Claude로 대체 가능)
    const estimatedKcal = estimateCalories(description);

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

    // M4-2: FoodLog 생성 + 칼로리 밸런스 재계산을 Serializable 트랜잭션에서 원자화.
    // 직렬화 충돌(P2034) 시 자동 재시도로 동시 요청 안전 보장.
    const log = await withSerializableRetry(async (tx) => {
      const created = await tx.foodLog.create({
        data: {
          date: foodDate,
          description,
          estimatedKcal,
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

// 간단한 키워드 기반 칼로리 추정 (향후 AI로 교체)
function estimateCalories(description: string): number {
  const lower = description.toLowerCase();
  let kcal = 500; // 기본값

  if (lower.includes("샐러드") || lower.includes("salad")) kcal = 300;
  else if (lower.includes("라면") || lower.includes("ramen")) kcal = 550;
  else if (lower.includes("치킨") || lower.includes("chicken")) kcal = 700;
  else if (lower.includes("밥") || lower.includes("rice")) kcal = 400;
  else if (lower.includes("빵") || lower.includes("bread")) kcal = 350;
  else if (lower.includes("커피") || lower.includes("coffee")) kcal = 100;
  else if (lower.includes("간식") || lower.includes("snack")) kcal = 250;
  else if (lower.includes("피자") || lower.includes("pizza")) kcal = 800;
  else if (lower.includes("고기") || lower.includes("meat")) kcal = 600;

  return kcal;
}
