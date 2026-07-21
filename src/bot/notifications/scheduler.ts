import cron from "node-cron";
import type { Bot } from "grammy";
import { generateMorningReport, generateEveningReport } from "../../lib/daily-report";
import { generateWeeklyReport } from "../../lib/weekly-report";
import { runAutoAdjustProposal } from "./auto-adjust";
import { runAutoAdjustMaintenance } from "./auto-adjust-cron";
import { mdToHtml } from "../utils/telegram";
import { sanitizeError } from "../utils/error";
import {
  formatUserFriendlyError,
  notifyAdminIfAuthExpired,
} from "@/lib/ai/claude-auth-monitor";
// #253: sendToAll/sendToAllWithKeyboard 은 별도 send.ts 로 이동 (auth-monitor 와 순환 import 방지).
// 기존 소비자를 위해 re-export.
export {
  sendToAll,
  sendToAllWithKeyboard,
  type SendResult,
  type SendKeyboardResult,
} from "./send";
import { sendToAll } from "./send";

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
    // #253: 인증 만료면 관리자 alert (rate-limited). best-effort.
    void notifyAdminIfAuthExpired(bot, error).catch(() => {});
    // 조용한 실패 차단: 사용자에게 카테고리 매핑 문구 (기존 raw msg 대체).
    try {
      const friendly = formatUserFriendlyError(error);
      await sendToAll(bot, `❌ ${label} 생성 실패\n${friendly}`);
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
