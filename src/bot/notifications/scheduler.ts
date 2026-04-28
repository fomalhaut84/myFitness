import cron from "node-cron";
import type { Bot } from "grammy";
import { generateMorningReport, generateEveningReport } from "../../lib/daily-report";
import { generateWeeklyReport } from "../../lib/weekly-report";
import { mdToHtml } from "../utils/telegram";

const MAX_MSG = 4096;

function getChatIds(): string[] {
  return (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

interface SendResult {
  sent: number;
  failed: number;
  total: number;
}

async function sendToAll(bot: Bot, text: string): Promise<SendResult> {
  const ids = getChatIds();
  let sent = 0;
  let failed = 0;
  for (const chatId of ids) {
    try {
      const msg = text.length > MAX_MSG ? text.slice(0, MAX_MSG - 3) + "..." : text;
      await bot.api.sendMessage(chatId, msg, { parse_mode: "HTML" });
      sent++;
    } catch (error) {
      console.error(`[bot] 메시지 전송 실패 (${chatId}):`, error);
      // HTML 실패 시 plain text fallback
      try {
        const plain = text.replace(/<[^>]*>/g, "").slice(0, MAX_MSG);
        await bot.api.sendMessage(chatId, plain);
        sent++;
      } catch (plainErr) {
        console.error(`[bot] plain text fallback도 실패 (${chatId}):`, plainErr);
        failed++;
      }
    }
  }
  return { sent, failed, total: ids.length };
}

/** 리포트 cron 콜백 공통 처리: 단계별 로그 + 실패 시 텔레그램 알림 (조용한 실패 차단) */
async function runReportCron(
  bot: Bot,
  label: string,
  emoji: string,
  generate: () => Promise<string>
) {
  console.log(`[bot-cron] ${label} 시작`);
  try {
    const report = await generate();
    const html = `${emoji} <b>${label}</b>\n\n${mdToHtml(report)}`;
    const r = await sendToAll(bot, html);
    if (r.total === 0) {
      console.warn(
        `[bot-cron] ${label} 전송 대상 없음 (TELEGRAM_ALLOWED_CHAT_IDS 미설정?)`
      );
    } else if (r.sent === 0) {
      // 모든 채팅 전송 실패 → 조용한 실패 차단을 위해 명시적 throw
      throw new Error(
        `sendToAll: 모든 채팅 전송 실패 (failed=${r.failed}/total=${r.total})`
      );
    } else {
      console.log(
        `[bot-cron] ${label} 전송 완료 (sent=${r.sent}/total=${r.total}${
          r.failed ? `, failed=${r.failed}` : ""
        })`
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[bot-cron] ${label} 에러:`, msg);
    // 조용한 실패 차단: 사용자에게 에러 알림 (sendToAll 자체도 실패할 수 있음)
    try {
      await sendToAll(bot, `❌ ${label} 생성 실패: ${msg.slice(0, 500)}`);
    } catch (notifyErr) {
      console.error(`[bot-cron] ${label} 에러 알림 전송도 실패:`, notifyErr);
    }
  }
}

export function startBotScheduler(bot: Bot) {
  // 모닝 리포트 (08:00 KST)
  const morningSchedule = process.env.MORNING_REPORT_CRON ?? "0 8 * * *";
  cron.schedule(
    morningSchedule,
    () => runReportCron(bot, "모닝 리포트", "☀️", () => generateMorningReport()),
    { timezone: "Asia/Seoul" }
  );

  // 이브닝 리포트 (23:00 KST)
  const eveningSchedule = process.env.EVENING_REPORT_CRON ?? "0 23 * * *";
  cron.schedule(
    eveningSchedule,
    () => runReportCron(bot, "이브닝 리포트", "🌙", () => generateEveningReport()),
    { timezone: "Asia/Seoul" }
  );

  // 주간 리포트 (월요일 07:00 KST)
  const weeklySchedule = process.env.REPORT_CRON ?? "0 7 * * 1";
  cron.schedule(
    weeklySchedule,
    () => runReportCron(bot, "주간 리포트", "📊", () => generateWeeklyReport()),
    { timezone: "Asia/Seoul" }
  );

  console.log(
    `[bot-cron] 알림 스케줄 등록 완료 (모닝=${morningSchedule}, 이브닝=${eveningSchedule}, 주간=${weeklySchedule}, TZ=Asia/Seoul)`
  );
}
