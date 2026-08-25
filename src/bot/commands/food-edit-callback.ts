// #292 (M14 Phase 2 #1): FoodLog inline keyboard callback 처리.
//   food:edit:<logId>      → kcal force_reply 프롬프트 (숫자 답장)
//   food:edit-desc:<logId> → 설명 force_reply 프롬프트 (텍스트 답장) — #309
//   food:delete:<logId>    → 즉시 삭제 + 원본 메시지 편집 + 재계산

import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import prisma from "../prisma";
import { Prisma } from "@/generated/prisma/client";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";
import { deletePendingEdit, markPendingEdit, peekPendingEdit } from "./food-edit-state";
import { applyKcalCorrection } from "@/lib/nutrition/scale-macros";

export const CALLBACK_PREFIX = "food";

/** callback_data 형식 `food:<action>:<logId>` 파싱. cuid 는 25자, prefix 포함 ~40자 < 64byte 안전. */
function parseCallbackData(
  data: string,
): { action: "edit" | "edit-desc" | "delete"; logId: string } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== CALLBACK_PREFIX) return null;
  const action = parts[1];
  if (action !== "edit" && action !== "edit-desc" && action !== "delete") return null;
  return { action, logId: parts[2] };
}

/** kcal 응답에 붙일 inline keyboard. logId 를 callback_data 에 embed.
 *  #309: 설명 정정 버튼 추가 → 3 버튼 (kcal · 설명 · 삭제). */
export function buildFoodInlineKeyboard(logId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔢 kcal", `${CALLBACK_PREFIX}:edit:${logId}`)
    .text("📝 설명", `${CALLBACK_PREFIX}:edit-desc:${logId}`)
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
          try {
            await ctx.answerCallbackQuery({ text: "이미 삭제된 로그입니다." });
          } catch {
            // ignore
          }
          try {
            await ctx.editMessageReplyMarkup({ reply_markup: undefined });
          } catch {
            // ignore
          }
          return;
        }
        console.error("[food-edit] delete 실패:", err);
        try {
          await ctx.answerCallbackQuery({ text: "삭제 중 오류가 발생했습니다." });
        } catch {
          // ignore
        }
        return;
      }

      // Codex P2 (#293): delete 성공 즉시 사용자 피드백 (callback ACK + keyboard 제거 + 안내
      // 메시지). recalc 는 이후 별도 try 로 처리 — 실패해도 UI 는 이미 반영됨. 각 API 호출은
      // 독립 try/catch 로 감싸 하나 실패해도 나머지 진행.
      try {
        await ctx.answerCallbackQuery({ text: "삭제되었습니다." });
      } catch {
        // ignore (Telegram callback timeout 등)
      }
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

      // 재계산 (실패 시 stale queue 로 위임). UI 응답 이후에 실행 — 지연 있어도 사용자 방해 X.
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
      return;
    }

    // action === "edit" or "edit-desc"
    // 로그 존재 확인 (이미 삭제된 상태에서 편집 시도 방지).
    // Codex P2 (#293): findUnique 가 transient DB 실패 시 사용자에게 안내 없이 spinner 지속 →
    // try/catch 로 답장 후 종료.
    let existing: {
      description: string;
      mealType: string | null;
      estimatedKcal: number | null;
    } | null;
    try {
      existing = await prisma.foodLog.findUnique({
        where: { id: logId },
        select: { description: true, mealType: true, estimatedKcal: true },
      });
    } catch (err) {
      console.error("[food-edit] edit lookup 실패:", err);
      try {
        await ctx.answerCallbackQuery({
          text: "로그 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        });
      } catch {
        // ignore
      }
      return;
    }
    if (!existing) {
      try {
        await ctx.answerCallbackQuery({ text: "이미 삭제된 로그입니다." });
      } catch {
        // ignore
      }
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // ignore
      }
      return;
    }

    try {
      await ctx.answerCallbackQuery();
    } catch {
      // ignore
    }
    // force_reply 로 프롬프트 발송. 답장 메시지의 reply_to_message.message_id 로 pending 조회.
    const chatId = ctx.chat?.id;
    if (action === "edit-desc") {
      // #309: 설명 정정 프롬프트. 답장 텍스트로 PATCH description → macros/attempts 리셋 →
      // backfill 재추정 (기존 PATCH /api/food/[id] 로직과 동일 정책).
      const prompt =
        `📝 "${existing.description}" 의 새 설명을 텍스트로 답장해주세요.\n` +
        `설명 변경 시 kcal/매크로가 자동 재추정됩니다.`;
      const sent = await ctx.reply(prompt, {
        reply_markup: {
          force_reply: true,
          input_field_placeholder: "예: 치킨 샐러드 · 감자튀김",
        },
      });
      if (typeof chatId === "number") {
        markPendingEdit(chatId, sent.message_id, logId, "desc");
      }
    } else {
      const currentKcal = existing.estimatedKcal;
      const prompt =
        `🔢 "${existing.description}" 의 새 kcal 을 숫자로만 답장해주세요 (0~10000).\n` +
        (currentKcal !== null ? `현재 값: ${currentKcal} kcal` : "현재 값: 미측정");
      const sent = await ctx.reply(prompt, {
        reply_markup: { force_reply: true, input_field_placeholder: "예: 650" },
      });
      if (typeof chatId === "number") {
        markPendingEdit(chatId, sent.message_id, logId, "kcal");
      }
    }
  });
}

/**
 * 사용자가 편집 프롬프트에 답장했을 때 처리. bot/index.ts message:text 핸들러에서
 * reply_to_message 있으면 우선 호출.
 * 반환값: true 면 이 텍스트를 처리 완료 (다음 handler 로 넘기지 않음), false 면 pending 아님.
 *
 * Codex P2 (#293): peek → validate → 성공 시에만 delete. 검증 실패 (오타 등) 로 entry 삭제 안 함
 * → 사용자가 재답장 가능. 만료 tombstone 은 delete 처리 (재시도 무의미).
 */
export async function handleFoodEditReply(ctx: {
  chat?: { id?: number };
  reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
  message?: {
    text?: string;
    reply_to_message?: { message_id?: number };
  };
}): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (typeof chatId !== "number" || typeof replyToId !== "number") return false;
  const { logId, action, expired } = peekPendingEdit(chatId, replyToId);
  if (expired) {
    // 만료 안내 후 tombstone 제거 (재답장 무의미).
    deletePendingEdit(chatId, replyToId);
    await ctx.reply(
      "요청이 만료되었습니다 (5분 초과). 활동 상세에서 다시 편집해주세요.",
    );
    return true;
  }
  if (!logId || !action) return false;

  const raw = (ctx.message?.text ?? "").trim();

  // #309: 설명 정정 분기.
  // Codex P1 (PR #310 2회차): ctx.reply 를 unbound method 로 넘기면 grammy Context.reply 가
  // this.api / this.chatId 접근 시 undefined → throw. bound closure 로 전달.
  if (action === "desc") {
    const boundReply = (text: string, options?: Record<string, unknown>) =>
      ctx.reply(text, options);
    return handleDescReply(chatId, replyToId, logId, raw, boundReply);
  }

  // action === "kcal" (기본).
  // Codex P2 (#293): 검증 실패 시 새 force_reply 프롬프트 발송 + 원 entry 이전 후 신규 등록.
  // Telegram force_reply 는 one-shot 이라 사용자 다음 답장은 reply_to 없음 → routing 실패.
  // 새 프롬프트로 next reply 를 pending 에 다시 연결.
  const reissueForRetry = async (message: string): Promise<void> => {
    const sent = (await ctx.reply(message, {
      reply_markup: { force_reply: true, input_field_placeholder: "예: 650" },
    })) as { message_id?: number };
    deletePendingEdit(chatId, replyToId);
    if (typeof sent?.message_id === "number") {
      markPendingEdit(chatId, sent.message_id, logId);
    }
  };
  if (!/^\d+$/.test(raw)) {
    await reissueForRetry("0~10000 사이 정수만 입력해주세요. 예: 650");
    return true;
  }
  const kcal = parseInt(raw, 10);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 10000) {
    await reissueForRetry("kcal 은 0~10000 범위 정수여야 합니다.");
    return true;
  }

  try {
    // Codex P2 (PR #300 4회차/8회차): kcal 정정 concurrency-safe helper.
    const correction = await applyKcalCorrection(prisma, logId, kcal);
    if (!correction.ok) {
      if (correction.reason === "not-found") {
        deletePendingEdit(chatId, replyToId);
        await ctx.reply("이미 삭제된 로그입니다.");
      } else {
        await ctx.reply("동시 수정 감지, 잠시 후 다시 시도해주세요.");
      }
      return true;
    }
    const updated = await prisma.foodLog.findUnique({
      where: { id: logId },
      select: { date: true, description: true },
    });
    if (!updated) {
      deletePendingEdit(chatId, replyToId);
      await ctx.reply("이미 삭제된 로그입니다.");
      return true;
    }
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
    // 성공 → entry 소비.
    deletePendingEdit(chatId, replyToId);
    await ctx.reply(
      `✏️ "${updated.description}" → ${kcal.toLocaleString("ko-KR")} kcal 로 수정됨`,
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      // 로그 자체가 삭제 — entry 도 무효, 삭제.
      deletePendingEdit(chatId, replyToId);
      await ctx.reply("이미 삭제된 로그입니다.");
      return true;
    }
    console.error("[food-edit] update 실패:", err);
    await ctx.reply("kcal 수정 중 오류가 발생했습니다.");
    // update 실패 — entry 유지, 재답장 가능.
  }
  return true;
}

/**
 * #309: 설명 정정 답장 처리. 새 description 으로 PATCH — macros/attempts/kcal 을 모두 null
 * 리셋해 backfill 이 재추정 (PATCH /api/food/[id] descOrMealChanged 로직과 동일 정책).
 */
async function handleDescReply(
  chatId: number,
  replyToId: number,
  logId: string,
  raw: string,
  reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>,
): Promise<boolean> {
  const trimmed = raw.trim();
  const reissueForRetry = async (message: string): Promise<void> => {
    const sent = (await reply(message, {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "예: 치킨 샐러드 · 감자튀김",
      },
    })) as { message_id?: number };
    deletePendingEdit(chatId, replyToId);
    if (typeof sent?.message_id === "number") {
      markPendingEdit(chatId, sent.message_id, logId, "desc");
    }
  };
  if (trimmed.length === 0) {
    await reissueForRetry("설명은 비워둘 수 없습니다. 텍스트로 답장해주세요.");
    return true;
  }
  if (trimmed.length > 500) {
    await reissueForRetry("설명은 500자 이내로 입력해주세요.");
    return true;
  }

  try {
    // 기존 description 과 동일하면 no-op — DB 건드리지 않음.
    const existing = await prisma.foodLog.findUnique({
      where: { id: logId },
      select: { description: true, date: true },
    });
    if (!existing) {
      deletePendingEdit(chatId, replyToId);
      await reply("이미 삭제된 로그입니다.");
      return true;
    }
    if (existing.description === trimmed) {
      deletePendingEdit(chatId, replyToId);
      await reply(`ℹ️ 이미 "${trimmed}" 로 저장되어 있습니다 (변경 없음).`);
      return true;
    }

    await prisma.foodLog.update({
      where: { id: logId },
      data: {
        description: trimmed,
        estimatedKcal: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        nutritionAttempts: null,
        // #322 Codex P2: description 이 바뀌면 items 도 stale (이전 컨텍스트 breakdown).
        // null 로 클리어 → backfill 이 새 description 으로 재추정.
        items: Prisma.DbNull,
      },
    });

    // 재계산 — kcal 이 null 로 리셋됐으므로 밸런스 재계산 (다른 로그 반영). 실패 시 stale queue.
    try {
      await recalculateCalorieBalance(existing.date, undefined, prisma);
    } catch (recalcErr) {
      console.warn(
        "[food-edit-desc] 재계산 실패, stale queue 등록:",
        recalcErr instanceof Error ? recalcErr.message : String(recalcErr),
      );
      try {
        await markStaleRecalcDate(existing.date);
      } catch {
        // ignore
      }
    }

    deletePendingEdit(chatId, replyToId);
    await reply(
      `📝 설명 변경 완료: "${trimmed}"\n` +
        `kcal/매크로는 backfill cron 이 곧 재추정합니다.`,
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      deletePendingEdit(chatId, replyToId);
      await reply("이미 삭제된 로그입니다.");
      return true;
    }
    console.error("[food-edit-desc] update 실패:", err);
    await reply("설명 수정 중 오류가 발생했습니다.");
    // entry 유지, 재답장 가능.
  }
  return true;
}
