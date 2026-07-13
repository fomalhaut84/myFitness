import type { Bot } from "grammy";
import { askAdvisor, resetSession } from "../../lib/ai/claude-advisor";
import {
  generateMorningReport,
  generateEveningReport,
} from "../../lib/daily-report";
import { generateWeeklyReport } from "../../lib/weekly-report";
import { mdToHtml, replyLong } from "../utils/telegram";

let isProcessing = false;

type ReportType = "morning" | "evening" | "weekly";

/**
 * #212: /ai text 에서 리포트 요청 감지. "리포트" 키워드 필수 (자연 질문과 구분).
 * "이번 주 러닝 분석해줘" 같은 자연 질문은 null 반환 → 기존 askAdvisor 흐름 유지.
 */
export function parseReportRequest(text: string): ReportType | null {
  if (!/리포트|report/i.test(text)) return null;
  if (/모닝|아침|morning/i.test(text)) return "morning";
  if (/이브닝|저녁|evening/i.test(text)) return "evening";
  if (/주간|이번\s?주|weekly/i.test(text)) return "weekly";
  return null;
}

const REPORT_LABEL: Record<ReportType, string> = {
  morning: "모닝",
  evening: "이브닝",
  weekly: "주간",
};

async function runReportFromAiCommand(type: ReportType): Promise<string> {
  // force=true: /ai 로 명시 요청은 항상 새로 생성. 기존 record 는 $transaction 안
  // deleteMany + create 로 update-like 처리 (사용자 요구 사항 그대로).
  if (type === "morning") return generateMorningReport(true);
  if (type === "evening") return generateEveningReport(true);
  return generateWeeklyReport(true);
}

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
    // #212: 리포트 요청 감지 → generateXReport 로 DB 저장 흐름. 자연 질문은 그대로 askAdvisor.
    const reportType = parseReportRequest(question);
    if (reportType) {
      await ctx.reply(`📝 ${REPORT_LABEL[reportType]} 리포트 생성 중...`);
      const result = await runReportFromAiCommand(reportType);
      const html = mdToHtml(result);
      await replyLong(ctx as Parameters<typeof replyLong>[0], html, true);
      await ctx.reply(`✅ ${REPORT_LABEL[reportType]} 리포트 저장 완료`);
      return;
    }
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
