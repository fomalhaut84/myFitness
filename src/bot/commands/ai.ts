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
    resetSession("telegram");
    await ctx.reply("🔄 AI 세션이 초기화되었습니다.");
  });
}

export async function handleAiQuestion(ctx: { reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>; chat: { id: number } }, question: string) {
  if (isProcessing) {
    await ctx.reply("⏳ 이전 질문 처리 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  // isProcessing 보호: 모든 await 를 try 안에 두어 finally에서 무조건 false로 reset.
  // 기존 코드는 "분석 중..." reply가 try 밖이라 grammY/Telegram 에러로 throw 시
  // isProcessing 영구 true → 이후 모든 AI 질문 차단되는 버그가 있었음.
  isProcessing = true;
  try {
    await ctx.reply("🤔 분석 중...");
    const { result } = await askAdvisor(question, { channel: "telegram" });
    const html = mdToHtml(result);
    await replyLong(ctx as Parameters<typeof replyLong>[0], html, true);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // 사용자 알림 reply 자체도 실패 가능 — 그 경우는 bot.catch 또는 unhandledRejection으로 위임.
    try {
      await ctx.reply(`❌ AI 오류: ${msg.slice(0, 200)}`);
    } catch {
      // ignore — outer handler 가 로깅
    }
  } finally {
    isProcessing = false;
  }
}
