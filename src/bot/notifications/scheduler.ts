import cron from "node-cron";
import type { Bot, InlineKeyboard } from "grammy";
import { generateMorningReport, generateEveningReport } from "../../lib/daily-report";
import { generateWeeklyReport } from "../../lib/weekly-report";
import { runAutoAdjustProposal } from "./auto-adjust";
import { runAutoAdjustMaintenance } from "./auto-adjust-cron";
import { mdToHtml } from "../utils/telegram";
import { sanitizeError, isNetworkError, isHtmlParseError } from "../utils/error";

const MAX_MSG = 4096;
// 시도 사이 sleep 시간. 총 시도 = RETRY_DELAYS_MS.length + 1 = 4회 (초기 + 3 재시도).
// HTML→plain 전환(attempt--)이 발동하면 최악의 경우 5회까지 늘어날 수 있으나, plain
// 페이로드는 parse_mode 없이 전송되므로 HTML parse 에러가 재발할 수 없어 1회 추가에 그침.
const RETRY_DELAYS_MS = [2000, 8000, 30000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string): string {
  return text.length > MAX_MSG ? text.slice(0, MAX_MSG - 3) + "..." : text;
}

async function sendOneWithRetry(
  bot: Bot,
  chatId: string,
  htmlText: string
): Promise<void> {
  const html = truncate(htmlText);
  const plain = truncate(htmlText.replace(/<[^>]*>/g, ""));
  let useHtml = true;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      if (useHtml) {
        await bot.api.sendMessage(chatId, html, { parse_mode: "HTML" });
      } else {
        await bot.api.sendMessage(chatId, plain);
      }
      return;
    } catch (err) {
      lastErr = err;
      // HTML parse 에러 → 같은 시도 횟수로 plain 모드 전환 (백오프 없이 즉시 재시도)
      if (useHtml && isHtmlParseError(err)) {
        useHtml = false;
        attempt--;
        continue;
      }
      if (!isNetworkError(err) || attempt === MAX_ATTEMPTS - 1) {
        throw err;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[bot] 전송 재시도 ${attempt + 1}/${MAX_ATTEMPTS} (${chatId}, ${delay}ms 후): ${sanitizeError(err)}`
      );
      await sleep(delay);
    }
  }
  throw lastErr ?? new Error("sendOneWithRetry: 재시도 모두 실패 (원인 미상)");
}

export async function sendToAll(bot: Bot, text: string): Promise<SendResult> {
  const ids = getChatIds();
  let sent = 0;
  let failed = 0;
  for (const chatId of ids) {
    try {
      await sendOneWithRetry(bot, chatId, text);
      sent++;
    } catch (err) {
      failed++;
      console.error(`[bot] 메시지 전송 실패 (${chatId}): ${sanitizeError(err)}`);
    }
  }
  return { sent, failed, total: ids.length };
}

export interface SendKeyboardResult extends SendResult {
  /** 첫 번째 성공 전송의 chatId + messageId (callback 매칭용). 모두 실패 시 undefined. */
  first?: { chatId: string; messageId: number };
}

/**
 * inline keyboard 첨부 전송. HTML fallback 없음 (HTML 이 실패해도 keyboard 는 유지).
 * 재시도 로직 없이 단순 전송 — 재시도 필요 시 개별 확장.
 * 첫 성공 결과만 캡처 (M13 Phase 2 는 사용자 1명 기준).
 */
export async function sendToAllWithKeyboard(
  bot: Bot,
  text: string,
  keyboard: InlineKeyboard,
): Promise<SendKeyboardResult> {
  const ids = getChatIds();
  const html = truncate(text);
  let sent = 0;
  let failed = 0;
  let first: SendKeyboardResult["first"];
  for (const chatId of ids) {
    try {
      const msg = await bot.api.sendMessage(chatId, html, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      sent++;
      if (!first) first = { chatId, messageId: msg.message_id };
    } catch (err) {
      failed++;
      console.error(
        `[bot] keyboard 메시지 전송 실패 (${chatId}): ${sanitizeError(err)}`,
      );
    }
  }
  return { sent, failed, total: ids.length, first };
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
    const msg = sanitizeError(error);
    console.error(`[bot-cron] ${label} 에러: ${msg}`);
    // 조용한 실패 차단: 사용자에게 에러 알림 (sendToAll 자체도 실패할 수 있음)
    try {
      await sendToAll(bot, `❌ ${label} 생성 실패: ${msg.slice(0, 500)}`);
    } catch (notifyErr) {
      console.error(`[bot-cron] ${label} 에러 알림 전송도 실패: ${sanitizeError(notifyErr)}`);
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

  // M13 Phase 1 (#243): auto-adjust 사전 알림 (06:30 KST, 모닝 리포트 08:00 전).
  // 조정 필요 시만 push (조용한 skip). Phase 2 부터 accept/reject/snooze flow (#249).
  const autoAdjustSchedule = process.env.AUTO_ADJUST_CRON ?? "30 6 * * *";
  cron.schedule(autoAdjustSchedule, () => runAutoAdjustProposal(bot), {
    timezone: "Asia/Seoul",
  });

  // M13 Phase 2 (#249): 5분 주기 snooze 재전송 + TTL expire 유지 cron.
  const maintenanceSchedule =
    process.env.AUTO_ADJUST_MAINTENANCE_CRON ?? "*/5 * * * *";
  cron.schedule(
    maintenanceSchedule,
    () => {
      runAutoAdjustMaintenance(bot).catch((err) => {
        console.error(`[auto-adjust-cron] tick 실패: ${sanitizeError(err)}`);
      });
    },
    { timezone: "Asia/Seoul" },
  );

  console.log(
    `[bot-cron] 알림 스케줄 등록 완료 (모닝=${morningSchedule}, 이브닝=${eveningSchedule}, 주간=${weeklySchedule}, auto-adjust=${autoAdjustSchedule}, maintenance=${maintenanceSchedule}, TZ=Asia/Seoul)`
  );
}
