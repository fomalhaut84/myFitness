import prisma from "../prisma";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { estimateKcalFromText, type KcalEstimate } from "@/lib/nutrition/estimate-kcal";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";

/**
 * recalculateCalorieBalance 를 소규모 재시도. 최종 실패면 stale-recalc 큐에 date 를 기록해
 * 다음 cron tick 이 이어받게 함.
 */
async function recalcWithRetry(date: Date, retries: number): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await recalculateCalorieBalance(date, undefined, prisma);
      return true;
    } catch (err) {
      if (attempt === retries) {
        console.error(
          `[bot/food] recalculate 최종 실패 (date ${date.toISOString()}): ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          await markStaleRecalcDate(date);
        } catch (mErr) {
          console.error(
            `[bot/food] stale-recalc 큐 기록 실패: ${mErr instanceof Error ? mErr.message : String(mErr)}`,
          );
        }
        return false;
      }
      // 재시도 전 짧은 backoff
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  return false;
}

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

/**
 * 식단 접두사 뒤 description 이 실제 음식이 아니라 봇 명령/요청 문장일 때 감지.
 * 사용자가 `아침 리포트 새로 생성해줘` 같은 입력을 하면 이전엔 `아침` 접두사만 보고 음식으로
 * 저장 → 매 backfill tick 마다 AI 가 "음식 아님" 응답 → 영영 permanent-fail (사용자 실측).
 *
 * 판정:
 * - 문장 끝 `?` (음식 description 에 `?` 붙일 이유 없음)
 * - 요청/명령 어미 문장 끝 (~해줘, ~해봐, ~해주세요, ~부탁, ~알려줘, ~보여줘, ~봐줘)
 * - 물음 어미 문장 끝 (~뭐야, ~어때)
 * - 질문 단어 whitespace/문두/문말 boundary (왜, 어떻게) — Codex P2 (#289): 종결형이 아니라
 *   문장 중간에 오는 경우 (`리포트 왜 이상해?`) 도 캐치.
 *
 * Codex P2 이전 지적: 앞자리 keyword (만들/추천/보여/알려) 매칭은 명사 활용형 오탐하므로 제거.
 * 실제 음식 description 은 명사·수량 위주라 어미 패턴에 걸릴 확률 낮음.
 */
export function isCommandLikeDescription(description: string): boolean {
  const trimmed = description.trim();
  if (trimmed.length === 0) return false;
  // 문장 끝 물음표 (음식 description 에 `?` 붙일 이유 없음).
  if (/\?[\s.!~]*$/.test(trimmed)) return true;
  // 요청/명령 어미 (문장 끝 근처, 문장부호 무시).
  // Codex P2 (#289): 공손 종결 `-줘요` (해줘요, 알려줘요, 보여줘요, 봐줘요, 부탁드려요) 도 인식.
  if (
    /(해줘|해봐|해달라|해주세요|부탁(드립?니다|드려요)?|알려줘|보여줘|봐줘)(요)?[\s.!?~]*$/.test(
      trimmed,
    )
  ) {
    return true;
  }
  // 물음 어미 (문장 종결형).
  if (/(뭐야|어때)[\s.!?~]*$/.test(trimmed)) return true;
  // 질문 단어가 문장 중간/끝에 whitespace boundary 로 나오면 문장 자체가 질문.
  // "리포트 왜 이상해?", "김치찌개 어떻게 만들어" 등.
  if (/(^|\s)(왜|어떻게)(\s|$)/.test(trimmed)) return true;
  return false;
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

  // 명령/요청 문장이면 저장하지 않고 안내만. FoodLog 오염 (계속 backfill 재시도) 방지.
  if (isCommandLikeDescription(description)) {
    const mealLabel = MEAL_LABELS[mealType] ?? mealType;
    await ctx.reply(
      `"${mealLabel} ${description}" 이 식단이 맞나요?\n` +
        `식단이면 음식 이름/양으로 다시 입력해주세요 (예: ${mealLabel} 김치찌개 밥 1공기).\n` +
        `AI 질문·명령이면 접두사 없이 그대로 보내주세요.`,
    );
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

  // 3) 추정 성공 시 조건부 update + 칼로리 밸런스 재계산.
  //    Codex P2: update 가 transient 실패하면 estimate 를 null 로 되돌려 사용자 응답이 "실패"
  //    경로 로 가게. 그렇지 않으면 bot 이 "kcal 기록됨" 이라고 알리는데 DB 는 null → 누락.
  //    Codex P2 (race): AI 호출 중 (~15s) 사용자가 웹에서 이 row 의 kcal 을 수동 정정할 수 있음.
  //    조건부 updateMany 로 estimatedKcal 이 여전히 null 일 때만 갱신 → 수동 정정 보존.
  if (estimate) {
    try {
      // Codex P2 (description race): AI 호출 중 사용자가 description 을 PATCH 로 바꿨으면
      // 우리가 estimate 한 값은 old-desc 기준이라 stale. description/mealType 스냅샷 조건 추가.
      const updated = await prisma.foodLog.updateMany({
        where: {
          id: log.id,
          estimatedKcal: null,
          description,
          mealType,
        },
        data: { estimatedKcal: estimate.kcal },
      });
      if (updated.count === 0) {
        // 사용자가 그 사이 수동 정정 or description 변경 → AI 결과 반영 안 함. "실패" 경로.
        estimate = null;
      }
    } catch (err) {
      console.warn(
        "[bot/food] estimatedKcal update 실패:",
        err instanceof Error ? err.message : String(err),
      );
      estimate = null;
    }
  }

  // 4) 칼로리 밸런스 재계산. Codex P2 (#283): recalcWithRetry 로 즉시 재시도 + 실패 시 큐 mark →
  //    cron 이 이어받음 (kcal 이 성공 저장된 경우 backfill 은 이 row 를 다시 안 뽑기 때문).
  await recalcWithRetry(now, 1);

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
    // Codex P2: 재계산 실패해도 kcal 은 이미 저장됨 → 백필이 이 row 를 다시 안 뽑음 →
    // DailySummary 가 stale 로 남을 수 있음 (특히 historical 로그, cron 2일 창 밖).
    // 즉시 1회 재시도. 그래도 실패면 사용자에게 명시 경고.
    const recalcOk = await recalcWithRetry(updated.date, 1);
    const label = updated.mealType ? MEAL_LABELS[updated.mealType] ?? updated.mealType : "";
    const tail = recalcOk ? "" : "\n⚠️ 일일 요약 재계산 실패 — 잠시 후 자동 재시도됩니다.";
    await ctx.reply(
      `✏️ ${label} "${updated.description}" → ${kcal.toLocaleString("ko-KR")} kcal 로 수정됨${tail}`,
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
