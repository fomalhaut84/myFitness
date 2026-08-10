// #292 (M14 Phase 2 #1): FoodLog inline keyboard callback 처리.
//   food:edit:<logId>   → force_reply 프롬프트 발송 + pending state 등록
//   food:delete:<logId> → 즉시 삭제 + 원본 메시지 편집 + 재계산

import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import prisma from "../prisma";
import { Prisma } from "@/generated/prisma/client";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";
import { markPendingEdit } from "./food-edit-state";

export const CALLBACK_PREFIX = "food";

/** callback_data 형식 `food:<action>:<logId>` 파싱. cuid 는 25자, prefix 포함 ~35자 < 64byte 안전. */
function parseCallbackData(
  data: string,
): { action: "edit" | "delete"; logId: string } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== CALLBACK_PREFIX) return null;
  const action = parts[1];
  if (action !== "edit" && action !== "delete") return null;
  return { action, logId: parts[2] };
}

/** kcal 응답에 붙일 inline keyboard. logId 를 callback_data 에 embed. */
export function buildFoodInlineKeyboard(logId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ 수정", `${CALLBACK_PREFIX}:edit:${logId}`)
    .text("🗑️ 삭제", `${CALLBACK_PREFIX}:delete:${logId}`);
}

/** grammy bot 에 callback handler 등록. bot.callbackQuery(/^food:/, ...) 로 매칭. */
export function registerFoodEditCallback(bot: Bot): void {
  bot.callbackQuery(new RegExp(`^${CALLBACK_PREFIX}:`), async (ctx) => {
    const data = ctx.callbackQuery.data ?? "";
    const parsed = parseCallbackData(data);
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: "알 수 없는 요청입니다." });
      return;
    }
    const { action, logId } = parsed;

    if (action === "delete") {
      let deletedDate: Date | null = null;
      try {
        const row = await prisma.foodLog.delete({
          where: { id: logId },
          select: { date: true },
        });
        deletedDate = row.date;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2025"
        ) {
          await ctx.answerCallbackQuery({ text: "이미 삭제된 로그입니다." });
          // 원본 메시지 keyboard 만 제거 (텍스트는 두어 사용자가 어떤 로그였는지 인지).
          try {
            await ctx.editMessageReplyMarkup({ reply_markup: undefined });
          } catch {
            // ignore
          }
          return;
        }
        console.error("[food-edit] delete 실패:", err);
        await ctx.answerCallbackQuery({ text: "삭제 중 오류가 발생했습니다." });
        return;
      }

      // 재계산 (실패 시 stale queue 로 위임).
      try {
        await recalculateCalorieBalance(deletedDate, undefined, prisma);
      } catch (recalcErr) {
        console.warn(
          "[food-edit] delete 후 재계산 실패, stale queue 등록:",
          recalcErr instanceof Error ? recalcErr.message : String(recalcErr),
        );
        try {
          await markStaleRecalcDate(deletedDate);
        } catch {
          // ignore
        }
      }

      await ctx.answerCallbackQuery({ text: "삭제되었습니다." });
      // 원본 메시지: keyboard 제거 + 삭제됨 표시. editMessageText 는 원문을 잃으므로
      // reply_markup 만 지우고 별도 안내 메시지 발송 (context 유지).
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // ignore
      }
      try {
        await ctx.reply("🗑️ 위 기록이 삭제되었습니다.");
      } catch {
        // ignore
      }
      return;
    }

    // action === "edit"
    // 로그 존재 확인 (이미 삭제된 상태에서 편집 시도 방지).
    const existing = await prisma.foodLog.findUnique({
      where: { id: logId },
      select: { description: true, mealType: true, estimatedKcal: true },
    });
    if (!existing) {
      await ctx.answerCallbackQuery({ text: "이미 삭제된 로그입니다." });
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // ignore
      }
      return;
    }

    await ctx.answerCallbackQuery();
    // force_reply 로 프롬프트 발송. 답장 메시지의 reply_to_message.message_id 로 pending 조회.
    const currentKcal = existing.estimatedKcal;
    const prompt =
      `🔢 "${existing.description}" 의 새 kcal 을 숫자로만 답장해주세요 (0~10000).\n` +
      (currentKcal !== null ? `현재 값: ${currentKcal} kcal` : "현재 값: 미측정");
    const sent = await ctx.reply(prompt, {
      reply_markup: { force_reply: true, input_field_placeholder: "예: 650" },
    });
    // sent.message_id 를 key 로 pending state 저장.
    markPendingEdit(sent.message_id, logId);
  });
}

/**
 * 사용자가 편집 프롬프트에 답장했을 때 처리. bot/index.ts message:text 핸들러에서
 * reply_to_message 있으면 우선 호출.
 * 반환값: true 면 이 텍스트를 처리 완료 (다음 handler 로 넘기지 않음), false 면 pending 아님.
 */
export async function handleFoodEditReply(
  ctx: {
    reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
    message?: {
      text?: string;
      reply_to_message?: { message_id?: number };
    };
  },
  consumePendingEditFn: (id: number) => { logId: string | null; expired: boolean },
): Promise<boolean> {
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (typeof replyToId !== "number") return false;
  const { logId, expired } = consumePendingEditFn(replyToId);
  if (expired) {
    await ctx.reply(
      "요청이 만료되었습니다 (5분 초과). 활동 상세에서 다시 편집해주세요.",
    );
    return true;
  }
  if (!logId) return false;

  const raw = (ctx.message?.text ?? "").trim();
  if (!/^\d+$/.test(raw)) {
    await ctx.reply("0~10000 사이 정수만 입력해주세요. 예: 650");
    return true;
  }
  const kcal = parseInt(raw, 10);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 10000) {
    await ctx.reply("kcal 은 0~10000 범위 정수여야 합니다.");
    return true;
  }

  try {
    const updated = await prisma.foodLog.update({
      where: { id: logId },
      data: { estimatedKcal: kcal },
      select: { date: true, description: true },
    });
    try {
      await recalculateCalorieBalance(updated.date, undefined, prisma);
    } catch (recalcErr) {
      console.warn(
        "[food-edit] reply 후 재계산 실패, stale queue 등록:",
        recalcErr instanceof Error ? recalcErr.message : String(recalcErr),
      );
      try {
        await markStaleRecalcDate(updated.date);
      } catch {
        // ignore
      }
    }
    await ctx.reply(
      `✏️ "${updated.description}" → ${kcal.toLocaleString("ko-KR")} kcal 로 수정됨`,
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      await ctx.reply("이미 삭제된 로그입니다.");
      return true;
    }
    console.error("[food-edit] update 실패:", err);
    await ctx.reply("kcal 수정 중 오류가 발생했습니다.");
  }
  return true;
}
