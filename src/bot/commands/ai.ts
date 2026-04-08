import type { Bot } from "grammy";
import { askAdvisor, resetSession } from "../../lib/ai/claude-advisor";
import { mdToHtml, replyLong } from "../utils/telegram";

let isProcessing = false;

export function registerAiCommands(bot: Bot) {
  bot.command("ai", async (ctx) => {
    const question = ctx.match?.toString().trim();
    if (!question) {
      await ctx.reply("사용법: /ai [질문]\n예: /ai 이번 주 러닝 분석해줘");
      return;
    }
    await handleAiQuestion(ctx, question);
  });

  bot.command("reset", async (ctx) => {
    resetSession();
    await ctx.reply("🔄 AI 세션이 초기화되었습니다.");
  });
}

export async function handleAiQuestion(ctx: { reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>; chat: { id: number } }, question: string) {
  if (isProcessing) {
    await ctx.reply("⏳ 이전 질문 처리 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  isProcessing = true;
  await ctx.reply("🤔 분석 중...");

  try {
    const { result } = await askAdvisor(question);
    const html = mdToHtml(result);
    await replyLong(ctx as Parameters<typeof replyLong>[0], html, true);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await ctx.reply(`❌ AI 오류: ${msg.slice(0, 200)}`);
  } finally {
    isProcessing = false;
  }
}
