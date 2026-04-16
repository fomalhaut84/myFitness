import prisma from "../prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";

const MEAL_PATTERNS = [
  { pattern: /^(아침|조식)/, type: "breakfast" },
  { pattern: /^(점심|중식)/, type: "lunch" },
  { pattern: /^(저녁|석식)/, type: "dinner" },
  { pattern: /^(간식|야식)/, type: "snack" },
];

export function isFoodInput(text: string): boolean {
  return MEAL_PATTERNS.some((m) => m.pattern.test(text));
}

export async function handleFoodInput(
  ctx: { reply: (text: string, options?: Record<string, unknown>) => Promise<unknown> },
  text: string
) {
  const meal = MEAL_PATTERNS.find((m) => m.pattern.test(text));
  const mealType = meal?.type ?? "snack";
  const description = text.replace(meal?.pattern ?? "", "").trim();

  if (!description) {
    await ctx.reply("먹은 것을 함께 입력해주세요.\n예: 점심 김치찌개 밥 계란후라이");
    return;
  }

  const now = new Date();
  await prisma.foodLog.create({
    data: {
      date: now,
      description,
      mealType,
      estimatedKcal: null,
    },
  });

  // M4-2: 섭취 기록 후 칼로리 밸런스 재계산 (봇 prisma client 전달, 실패해도 봇 응답은 계속)
  try {
    await recalculateCalorieBalance(now, undefined, prisma);
  } catch (err) {
    console.error(
      "[bot/food] 칼로리 밸런스 재계산 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }

  const mealLabels: Record<string, string> = {
    breakfast: "아침", lunch: "점심", dinner: "저녁", snack: "간식",
  };

  await ctx.reply(
    `✅ ${mealLabels[mealType]} 기록 완료\n📝 ${description}`,
  );
}
