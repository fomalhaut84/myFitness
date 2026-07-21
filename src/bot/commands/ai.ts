import type { Bot } from "grammy";
import { askAdvisor, resetSession } from "../../lib/ai/claude-advisor";
import {
  generateMorningReport,
  generateEveningReport,
} from "../../lib/daily-report";
import { generateWeeklyReport } from "../../lib/weekly-report";
import {
  formatUserFriendlyError,
  notifyAdminIfKnownFailure,
} from "../../lib/monitoring/admin-alerts";
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
  if (!/리포트|report/i.test(text)) return null;
  // imperative form 만 매칭. descriptive form (만들어**진**, **만들어준**,
  // **생성된**, **뽑아놓**, generat**ed**) 은 진단 질문에서 흔함 → 오탐 방지.
  // - 한글 접미사: 진(피동), 준(수여), 놓(상태), 봤/봐(경험), 야(당위) 등
  // - 공백 있는 form (예: '만들어 진') 도 배제 위해 \s* 허용
  // - 영어: \b word boundary 로 원형만 (generated/created 등 파생 제외)
  // Codex bot P2 (#4683066284, #4683280516, #4683357105) 누적 반영.
  if (
    !/만들어(?!\s*[진지졌져짐준줬놓놨봤야])|생성해|뽑아(?!\s*[진지졌져준줬놓놨봤야])|재생성(?!\s*[된됨돼])|다시\s?만들[자아]|다시\s?만들어(?!\s*[진지졌져짐준줬놓놨봤야])|\bcreate\b|\bgenerate\b|\brefresh\b/i.test(
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

async function runReportFromAiCommand(
  type: ReportType,
  notifyBot?: Bot,
): Promise<string> {
  // force=true: /ai 로 명시 요청은 항상 새로 생성. 기존 record 는 $transaction 안
  // deleteMany + create 로 update-like 처리 (사용자 요구 사항 그대로).
  // #256 Codex bot PR #258 P2: notifyBot 전달 → preSync 중 Garmin 실패 시 admin alert.
  if (type === "morning")
    return generateMorningReport(true, undefined, { notifyBot });
  if (type === "evening")
    return generateEveningReport(true, undefined, { notifyBot });
  return generateWeeklyReport(true, { notifyBot });
}

export function registerAiCommands(bot: Bot) {
  bot.command("ai", async (ctx) => {
    const question = ctx.match?.toString().trim();
    if (!question) {
      await ctx.reply("사용법: /ai [질문]\n예: /ai 이번 주 러닝 분석해줘");
      return;
    }
    // #212: /ai 명시적 진입에서만 리포트 감지. bot/index.ts 자연어 fallback 은
    // 감지 skip → 오탐으로 인한 강제 재생성/덮어쓰기 원천 차단 (Codex bot P2).
    await handleAiQuestion(ctx, question, {
      detectReportRequest: true,
      bot,
    });
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
  options?: { detectReportRequest?: boolean; bot?: Bot },
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
    // #212: /ai 명시적 진입 (detectReportRequest=true) 에서만 리포트 감지.
    // Fallback 자연어 (bot/index.ts) 는 기본 false → 항상 askAdvisor.
    const reportType = options?.detectReportRequest
      ? parseReportRequest(question)
      : null;
    if (reportType) {
      await ctx.reply(`📝 ${REPORT_LABEL[reportType]} 리포트 생성 중...`);
      const result = await runReportFromAiCommand(reportType, options?.bot);
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
    // #253: 원본 message 는 서버 로그, 사용자에게는 카테고리 매핑 문구.
    // 인증 만료면 관리자에게 rate-limited alert (best-effort, catch 내부에서 무시).
    const rawMsg = error instanceof Error ? error.message : String(error);
    console.error(`[handleAiQuestion] 실패: ${rawMsg}`);
    void notifyAdminIfKnownFailure(options?.bot, error).catch(() => {});
    const friendly = formatUserFriendlyError(error);
    try {
      await ctx.reply(friendly);
    } catch {
      // ignore — outer handler 가 로깅
    }
  } finally {
    isProcessing = false;
  }
}
