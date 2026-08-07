import prisma from "../prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { estimateKcalFromText, type KcalEstimate } from "@/lib/nutrition/estimate-kcal";

const MEAL_PATTERNS = [
  { pattern: /^(아침|조식)/, type: "breakfast" },
  { pattern: /^(점심|중식)/, type: "lunch" },
  { pattern: /^(저녁|석식)/, type: "dinner" },
  { pattern: /^(간식|야식)/, type: "snack" },
];

const MEAL_LABELS: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

const CONFIDENCE_LABEL: Record<KcalEstimate["confidence"], string> = {
  low: "낮음",
  med: "중간",
  high: "높음",
};

export function isFoodInput(text: string): boolean {
  return MEAL_PATTERNS.some((m) => m.pattern.test(text));
}

interface BotCtx {
  reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
  /** grammy Context — replyWithChatAction 은 optional (테스트 mock 편의). */
  replyWithChatAction?: (action: "typing") => Promise<unknown>;
}

export async function handleFoodInput(
  ctx: BotCtx,
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
  // 1) FoodLog 먼저 저장 (kcal=null). AI 추정 실패해도 기록은 남게.
  const log = await prisma.foodLog.create({
    data: { date: now, description, mealType, estimatedKcal: null },
    select: { id: true },
  });

  // 사전 리뷰 P1-3: AI 호출 (~수초~15초) 중 사용자에게 "typing" 인디케이터 노출.
  // 실패해도 흐름 방해 안 됨.
  try {
    await ctx.replyWithChatAction?.("typing");
  } catch {
    // ignore
  }

  // 2) AI 로 kcal 추정 (실패 시 null). 완료까지 await — 사용자 응답은 한 번에.
  //    실패해도 log 저장은 이미 성공.
  let estimate: KcalEstimate | null = null;
  try {
    estimate = await estimateKcalFromText({ description, mealType });
  } catch (err) {
    console.warn(
      "[bot/food] kcal 추정 예외 (log 저장은 완료):",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 3) 추정 성공 시 update + 칼로리 밸런스 재계산.
  //    Codex P2: update 가 transient 실패하면 estimate 를 null 로 되돌려 사용자 응답이 "실패"
  //    경로 (kcal 미확정 안내 + 수동 입력 유도) 로 가게. 그렇지 않으면 bot 이 "kcal 기록됨"
  //    이라고 알리는데 DB 는 null → dashboard/리포트 총량에서 누락.
  if (estimate) {
    try {
      await prisma.foodLog.update({
        where: { id: log.id },
        data: { estimatedKcal: estimate.kcal },
      });
    } catch (err) {
      console.warn(
        "[bot/food] estimatedKcal update 실패:",
        err instanceof Error ? err.message : String(err),
      );
      estimate = null;
    }
  }

  // 4) 칼로리 밸런스 재계산 (kcal 이 null 이어도 다른 항목으로 갱신 가능성).
  try {
    await recalculateCalorieBalance(now, undefined, prisma);
  } catch (err) {
    console.error(
      "[bot/food] 칼로리 밸런스 재계산 실패:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 5) 사용자 응답.
  const label = MEAL_LABELS[mealType];
  const lines = [`✅ ${label} 기록 완료`, `📝 ${description}`];
  if (estimate) {
    lines.push(
      `📊 약 ${estimate.kcal.toLocaleString("ko-KR")} kcal (신뢰도 ${CONFIDENCE_LABEL[estimate.confidence]})`,
    );
    if (estimate.notes) lines.push(`ℹ️ ${estimate.notes}`);
    lines.push(`정정: /food_kcal ${log.id} <kcal>`);
  } else {
    lines.push("⚠️ kcal 자동 추정 실패");
    lines.push(`수동 입력: /food_kcal ${log.id} <kcal>`);
  }
  await ctx.reply(lines.join("\n"));
}

/**
 * `/food_kcal <id> <kcal>` — 이전 로그의 kcal 을 사용자 지정 값으로 갱신.
 * id 는 handleFoodInput 응답에 노출된 것.
 */
export async function handleFoodKcalCommand(
  ctx: BotCtx,
  raw: string,
): Promise<void> {
  // "/food_kcal <id> <kcal>" 또는 "/food_kcal@botname <id> <kcal>"
  // 사전 리뷰 P0: regex 상한 (\d{1,5}) 을 이후 검증 (kcal <= 10000) 과 일치시켜 UX 통일.
  const m = raw.match(/^\/food_kcal(?:@\S+)?\s+(\S+)\s+(\d{1,5})\s*$/);
  if (!m) {
    await ctx.reply("사용법: /food_kcal <id> <kcal>\n예: /food_kcal ckabc123 650");
    return;
  }
  const [, id, kcalStr] = m;
  const kcal = parseInt(kcalStr, 10);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 10000) {
    await ctx.reply("kcal 은 0~10000 범위 정수여야 합니다.");
    return;
  }
  try {
    const updated = await prisma.foodLog.update({
      where: { id },
      data: { estimatedKcal: kcal },
      select: { date: true, description: true, mealType: true },
    });
    try {
      await recalculateCalorieBalance(updated.date, undefined, prisma);
    } catch (err) {
      console.warn(
        "[bot/food_kcal] 재계산 실패:",
        err instanceof Error ? err.message : String(err),
      );
    }
    const label = updated.mealType ? MEAL_LABELS[updated.mealType] ?? updated.mealType : "";
    await ctx.reply(
      `✏️ ${label} "${updated.description}" → ${kcal.toLocaleString("ko-KR")} kcal 로 수정됨`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Record to update not found") || msg.includes("P2025")) {
      await ctx.reply(`해당 id 를 찾을 수 없습니다: ${id}`);
      return;
    }
    console.error("[bot/food_kcal] 수정 실패:", msg);
    await ctx.reply("kcal 수정 중 오류가 발생했습니다.");
  }
}
