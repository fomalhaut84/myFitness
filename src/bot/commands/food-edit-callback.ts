// #292 (M14 Phase 2 #1): FoodLog inline keyboard callback 처리.
//   food:edit:<logId>        → kcal 입력 프롬프트 (숫자)
//   food:edit-desc:<logId>   → 설명 입력 프롬프트 (텍스트) — #309
//   food:edit-cancel:<logId> → 편집 대기 취소 — #350
//   food:delete:<logId>      → 즉시 삭제 + 원본 메시지 편집 + 재계산
//
// #350: force_reply 폐기. Telegram 클라이언트가 force_reply 상태를 영구 보관해 답장 안 된
// 프롬프트가 채팅방을 열 때마다 답장 입력폼을 재무장시켰다 (Bot API 에 회수 수단 없음).
// 프롬프트를 일반 메시지 + [✕ 취소] inline 버튼으로 보내고, chat 단위 pending 으로 다음
// 텍스트를 라우팅한다. 상세: docs/specs/350-food-edit-force-reply-fix.md

import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import prisma from "../prisma";
import { Prisma } from "@/generated/prisma/client";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { markStaleRecalcDate } from "@/lib/nutrition/stale-recalc";
import {
  clearPendingEditFor,
  deletePendingEdit,
  markPendingEdit,
  peekPendingEdit,
  registerRetry,
} from "./food-edit-state";
import { applyKcalCorrection } from "@/lib/nutrition/scale-macros";

export const CALLBACK_PREFIX = "food";

/** callback_data 형식 `food:<action>:<logId>` 파싱. cuid 는 25자, prefix 포함 ~40자 < 64byte 안전. */
type CallbackAction = "edit" | "edit-desc" | "edit-cancel" | "delete";

const CALLBACK_ACTIONS: readonly CallbackAction[] = [
  "edit",
  "edit-desc",
  "edit-cancel",
  "delete",
];

function parseCallbackData(
  data: string,
): { action: CallbackAction; logId: string } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== CALLBACK_PREFIX) return null;
  const action = parts[1] as CallbackAction;
  if (!CALLBACK_ACTIONS.includes(action)) return null;
  return { action, logId: parts[2] };
}

/** #350: 편집 프롬프트에 붙는 취소 버튼. force_reply 대체 — 중단 수단 제공. */
function buildCancelKeyboard(logId: string): InlineKeyboard {
  return new InlineKeyboard().text(
    "✕ 취소",
    `${CALLBACK_PREFIX}:edit-cancel:${logId}`,
  );
}

/**
 * #350: 편집 흐름의 종료 메시지에 붙이는 markup.
 * ReplyKeyboardRemove 는 클라이언트의 reply markup 슬롯을 초기화하므로, 이 수정 이전에
 * 이미 박혀버린 force_reply 상태를 정리할 여지가 있다 (best-effort — 클라이언트 구현 의존).
 * 아무것도 떠 있지 않으면 no-op.
 */
const CLEAR_REPLY_MARKUP = { reply_markup: { remove_keyboard: true } } as const;

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

    // #350: 편집 대기 취소. DB 접근 불필요 — pending 만 정리한다.
    if (action === "edit-cancel") {
      const cancelChatId = ctx.chat?.id;
      if (typeof cancelChatId !== "number") {
        try {
          await ctx.answerCallbackQuery({ text: "처리할 수 없는 요청입니다." });
        } catch {
          // ignore
        }
        return;
      }
      const cleared = clearPendingEditFor(cancelChatId, logId);
      try {
        await ctx.answerCallbackQuery({
          text: cleared ? "편집을 취소했습니다." : "이미 종료된 요청입니다.",
        });
      } catch {
        // ignore (Telegram callback timeout 등)
      }
      // 취소 버튼 제거 — inline keyboard 라 editMessageReplyMarkup 으로 회수 가능.
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // ignore
      }
      if (cleared) {
        try {
          await ctx.reply("✕ 편집을 취소했습니다.", CLEAR_REPLY_MARKUP);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (action === "delete") {
      const deleteChatId = ctx.chat?.id;
      let deletedDate: Date | null = null;
      // 로그가 이미 없었던 경우 (웹 API 등 다른 경로로 삭제됨).
      let alreadyGone = false;
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
          alreadyGone = true;
        } else {
          console.error("[food-edit] delete 실패:", err);
          try {
            await ctx.answerCallbackQuery({ text: "삭제 중 오류가 발생했습니다." });
          } catch {
            // ignore
          }
          // 로그 존재 여부가 불확실하므로 pending 은 유지 — 재시도 가능해야 한다.
          return;
        }
      }

      // 사전 리뷰 P0 (#350): 편집 프롬프트를 띄운 상태에서 삭제하면 pending 이 남아 이후
      // 텍스트를 계속 삼킨다. 같은 로그의 pending 만 정리 (다른 편집은 건드리지 않음).
      // Codex P2 (PR #351): 대상 로그가 사라진 것이 확정된 **두 경로** — 삭제 성공과 P2025
      // (이미 삭제됨) — 모두에서 정리해야 한다. P2025 가 early return 하던 구조에서는 웹 API
      // 로 먼저 지운 뒤 봇 삭제 버튼을 누르면 pending 이 최대 5분간 살아남아 텍스트를 가로챘다.
      // 분기별 cleanup 을 빠뜨릴 수 없도록 단일 지점으로 합쳤다.
      if (typeof deleteChatId === "number") {
        clearPendingEditFor(deleteChatId, logId);
      }

      // deletedDate 를 함께 검사해 이후 recalculateCalorieBalance 호출까지 Date 로 좁힌다
      // (alreadyGone 일 때만 null 이므로 두 조건은 동치).
      if (alreadyGone || deletedDate === null) {
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
    // #350: 일반 메시지 + [✕ 취소] 로 프롬프트 발송. 이 chat 의 다음 텍스트가 편집 입력이 된다.
    // chat 당 pending 1건이라 버튼을 다시 눌러도 덮어쓰기 — 프롬프트 스태킹이 발생하지 않는다.
    const chatId = ctx.chat?.id;
    if (typeof chatId !== "number") return;

    if (action === "edit-desc") {
      // #309: 설명 정정 프롬프트. 입력 텍스트로 PATCH description → macros/attempts 리셋 →
      // backfill 재추정 (기존 PATCH /api/food/[id] 로직과 동일 정책).
      const prompt =
        `📝 "${existing.description}" 의 새 설명을 텍스트로 입력해주세요 (5분 이내).\n` +
        `설명 변경 시 kcal/매크로가 자동 재추정됩니다.`;
      await ctx.reply(prompt, { reply_markup: buildCancelKeyboard(logId) });
      markPendingEdit(chatId, logId, "desc");
    } else {
      const currentKcal = existing.estimatedKcal;
      const prompt =
        `🔢 "${existing.description}" 의 새 kcal 을 숫자로만 입력해주세요 (0~10000, 5분 이내).\n` +
        (currentKcal !== null ? `현재 값: ${currentKcal} kcal` : "현재 값: 미측정");
      await ctx.reply(prompt, { reply_markup: buildCancelKeyboard(logId) });
      markPendingEdit(chatId, logId, "kcal");
    }
  });
}

/**
 * 편집 프롬프트 이후 들어온 텍스트 처리. bot/index.ts message:text 핸들러에서 해당 chat 에
 * pending 이 있을 때 우선 호출.
 * 반환값: true 면 이 텍스트를 처리 완료 (다음 handler 로 넘기지 않음), false 면 pending 아님.
 *
 * #350: reply_to_message 의존 제거 — chat 단위 pending 으로 라우팅. 만료된 pending 은
 * peekPendingEdit 이 lazy delete 하고 null 을 반환하므로 false → 일반 라우팅으로 통과한다
 * (기존 grace tombstone 은 chat 단위에서 무관한 텍스트까지 삼키므로 제거).
 *
 * Codex P2 (#293): peek → validate → 성공 시에만 delete. 검증 실패 (오타 등) 로 entry 삭제 안 함
 * → 사용자가 재입력 가능.
 */
export async function handleFoodEditInput(ctx: {
  chat?: { id?: number };
  reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
  message?: { text?: string };
}): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") return false;
  const entry = peekPendingEdit(chatId);
  if (!entry) return false;
  const { logId, action } = entry;

  const raw = (ctx.message?.text ?? "").trim();

  // #309: 설명 정정 분기.
  // Codex P1 (PR #310 2회차): ctx.reply 를 unbound method 로 넘기면 grammy Context.reply 가
  // this.api / this.chatId 접근 시 undefined → throw. bound closure 로 전달.
  if (action === "desc") {
    const boundReply = (text: string, options?: Record<string, unknown>) =>
      ctx.reply(text, options);
    return handleDescReply(chatId, logId, raw, boundReply);
  }

  // action === "kcal" (기본).
  // Codex P2 (#293): 검증 실패 시 entry 를 삭제하지 않는다. 오타로 '650a' 를 보냈을 때 entry 가
  // 사라지면 정정한 '650' 이 AI 질문으로 흘러간다.
  // 사전 리뷰 P1 (#350): 재프롬프트는 registerRetry 로 상한을 건다. 무제한 TTL 갱신이면
  // 프롬프트를 잊고 대화를 이어갈 때 pending 이 영원히 만료되지 않고 모든 텍스트를 삼킨다.
  const reissueForRetry = async (message: string): Promise<void> => {
    if (!registerRetry(chatId)) {
      await ctx.reply(
        `${message}\n\n입력이 여러 번 형식에 맞지 않아 편집을 종료했습니다. ` +
          `다시 [🔢 kcal] 버튼을 눌러주세요.`,
        CLEAR_REPLY_MARKUP,
      );
      return;
    }
    await ctx.reply(message, { reply_markup: buildCancelKeyboard(logId) });
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
        deletePendingEdit(chatId);
        await ctx.reply("이미 삭제된 로그입니다.", CLEAR_REPLY_MARKUP);
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
      deletePendingEdit(chatId);
      await ctx.reply("이미 삭제된 로그입니다.", CLEAR_REPLY_MARKUP);
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
    deletePendingEdit(chatId);
    await ctx.reply(
      `✏️ "${updated.description}" → ${kcal.toLocaleString("ko-KR")} kcal 로 수정됨`,
      CLEAR_REPLY_MARKUP,
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      // 로그 자체가 삭제 — entry 도 무효, 삭제.
      deletePendingEdit(chatId);
      await ctx.reply("이미 삭제된 로그입니다.", CLEAR_REPLY_MARKUP);
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
  logId: string,
  raw: string,
  reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>,
): Promise<boolean> {
  const trimmed = raw.trim();
  // 사전 리뷰 P1 (#350): kcal 경로와 동일하게 재프롬프트 횟수에 상한.
  const reissueForRetry = async (message: string): Promise<void> => {
    if (!registerRetry(chatId)) {
      await reply(
        `${message}\n\n입력이 여러 번 형식에 맞지 않아 편집을 종료했습니다. ` +
          `다시 [📝 설명] 버튼을 눌러주세요.`,
        CLEAR_REPLY_MARKUP,
      );
      return;
    }
    await reply(message, { reply_markup: buildCancelKeyboard(logId) });
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
      deletePendingEdit(chatId);
      await reply("이미 삭제된 로그입니다.", CLEAR_REPLY_MARKUP);
      return true;
    }
    if (existing.description === trimmed) {
      deletePendingEdit(chatId);
      await reply(
        `ℹ️ 이미 "${trimmed}" 로 저장되어 있습니다 (변경 없음).`,
        CLEAR_REPLY_MARKUP,
      );
      return true;
    }
    // update 이후에는 조회할 수 없으므로 미리 보관 (성공 응답에 복구용으로 노출).
    const previousDescription = existing.description;

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

    deletePendingEdit(chatId);
    // 사전 리뷰 P1 (#350): desc 경로는 임의 텍스트가 그대로 description 이 되고 같은 update 로
    // kcal/매크로/items 가 전부 null 로 파기된다 (kcal 경로는 숫자 검증이 있어 비대칭).
    // 오소비 판별 대신 **복구 가능성**을 보장 — 이전 설명을 응답에 남긴다.
    await reply(
      `📝 설명 변경 완료: "${trimmed}"\n` +
        `이전 설명: "${previousDescription}" (잘못 바뀐 경우 [📝 설명] 로 되돌리세요)\n` +
        `kcal/매크로는 backfill cron 이 곧 재추정합니다.`,
      CLEAR_REPLY_MARKUP,
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      deletePendingEdit(chatId);
      await reply("이미 삭제된 로그입니다.", CLEAR_REPLY_MARKUP);
      return true;
    }
    console.error("[food-edit-desc] update 실패:", err);
    await reply("설명 수정 중 오류가 발생했습니다.");
    // entry 유지, 재답장 가능.
  }
  return true;
}
