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
 * #212: text 에서 리포트 **생성 요청** 감지.
 *
 * handleAiQuestion 은 /ai 뿐 아니라 봇의 자연어 fallback (src/bot/index.ts) 에서도
 * 호출됨. 따라서 "모닝 리포트 왜 이상해?" 같은 질문형까지 매칭되면 강제 재생성 →
 * 덮어쓰기 (Codex bot P2 #4682956892). 강한 창조 의도 (만들어/생성/뽑아/재생성 등)
 * 가 있을 때만 매칭.
 *
 * 자연 질문 (예: "이번 주 러닝 분석해줘") 은 null 반환 → 기존 askAdvisor 흐름.
 */
export function parseReportRequest(text: string): ReportType | null {
  // 두 조건 모두 필요: (1) 리포트/report 언급, (2) 명시적 생성 의도.
  if (!/리포트|report/i.test(text)) return null;
  // imperative form 만 매칭. descriptive form (만들어**진**, **생성된**, generat**ed**)
  // 은 진단/설명 질문에서 흔히 나타남 → 오탐 방지 (Codex bot P2).
  // 한글: negative lookahead 로 완료/피동 접미사 배제.
  // 영어: \b word boundary 로 원형만 매칭 (generated/created 는 skip).
  if (
    !/만들어(?![진지])|생성해|뽑아|재생성(?![된됨])|다시\s?만들[어자아]|\bcreate\b|\bgenerate\b|\brefresh\b/i.test(
      text,
    )
  ) {
    return null;
  }
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
    // #212: /ai 명시적 진입에서만 리포트 요청 감지. 자연어 fallback (bot/index.ts) 에서는
    // 감지 skip → 오탐으로 인한 강제 재생성/덮어쓰기 방지 (Codex bot P2).
    await handleAiQuestion(ctx, question, { detectReportRequest: true });
  });

  bot.command("reset", async (ctx) => {
    resetSession("telegram");
    await ctx.reply("🔄 AI 세션이 초기화되었습니다.");
  });
}

export async function handleAiQuestion(
  ctx: {
    reply: (
      text: string,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
    chat: { id: number };
  },
  question: string,
  options?: { detectReportRequest?: boolean },
) {
  if (isProcessing) {
    await ctx.reply("⏳ 이전 질문 처리 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  // isProcessing 보호: 모든 await 를 try 안에 두어 finally에서 무조건 false로 reset.
  // 기존 코드는 "분석 중..." reply가 try 밖이라 grammY/Telegram 에러로 throw 시
  // isProcessing 영구 true → 이후 모든 AI 질문 차단되는 버그가 있었음.
  isProcessing = true;
  try {
    // #212: /ai 명시적 진입 (detectReportRequest=true) 일 때만 리포트 감지.
    // Fallback 자연어 진입 (bot/index.ts) 에서는 항상 askAdvisor 로 → 오탐 위험 원천 차단.
    const reportType = options?.detectReportRequest
      ? parseReportRequest(question)
      : null;
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
