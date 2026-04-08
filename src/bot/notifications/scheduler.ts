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

async function sendToAll(bot: Bot, text: string) {
  for (const chatId of getChatIds()) {
    try {
      const msg = text.length > MAX_MSG ? text.slice(0, MAX_MSG - 3) + "..." : text;
      await bot.api.sendMessage(chatId, msg, { parse_mode: "HTML" });
    } catch (error) {
      console.error(`[bot] 메시지 전송 실패 (${chatId}):`, error);
      // HTML 실패 시 plain text
      try {
        const plain = text.replace(/<[^>]*>/g, "").slice(0, MAX_MSG);
        await bot.api.sendMessage(chatId, plain);
      } catch {
        // 무시
      }
    }
  }
}

export function startBotScheduler(bot: Bot) {
  // 모닝 리포트 (08:00 KST)
  const morningSchedule = process.env.MORNING_REPORT_CRON ?? "0 8 * * *";
  cron.schedule(
    morningSchedule,
    async () => {
      console.log("[bot-cron] 모닝 리포트 생성 + 전송");
      try {
        const report = await generateMorningReport();
        const html = `☀️ <b>모닝 리포트</b>\n\n${mdToHtml(report)}`;
        await sendToAll(bot, html);
      } catch (error) {
        console.error("[bot-cron] 모닝 리포트 에러:", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );

  // 이브닝 리포트 (23:00 KST)
  const eveningSchedule = process.env.EVENING_REPORT_CRON ?? "0 23 * * *";
  cron.schedule(
    eveningSchedule,
    async () => {
      console.log("[bot-cron] 이브닝 리포트 생성 + 전송");
      try {
        const report = await generateEveningReport();
        const html = `🌙 <b>이브닝 리포트</b>\n\n${mdToHtml(report)}`;
        await sendToAll(bot, html);
      } catch (error) {
        console.error("[bot-cron] 이브닝 리포트 에러:", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );

  // 주간 리포트 (월요일 07:00 KST)
  const weeklySchedule = process.env.REPORT_CRON ?? "0 7 * * 1";
  cron.schedule(
    weeklySchedule,
    async () => {
      console.log("[bot-cron] 주간 리포트 생성 + 전송");
      try {
        const report = await generateWeeklyReport();
        const html = `📊 <b>주간 리포트</b>\n\n${mdToHtml(report)}`;
        await sendToAll(bot, html);
      } catch (error) {
        console.error("[bot-cron] 주간 리포트 에러:", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );

  console.log("[bot-cron] 알림 스케줄 등록 완료 (모닝/이브닝/주간)");
}
