import type { Bot } from "grammy";
import { syncAll } from "../../lib/garmin/sync";
import { ACTIVITY_RECHECK_DAYS } from "../../lib/garmin/activity-recheck";

export function registerSyncCommand(bot: Bot) {
  bot.command("sync", async (ctx) => {
    await ctx.reply("🔄 Garmin 데이터 싱크 시작...");

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // #256 Codex bot 릴리즈 PR #258 P2: 수동 /sync 도 Garmin 재인증 실패 시 admin alert.
      const results = await syncAll({
        startDate: yesterday,
        endDate: today,
        notifyBot: bot,
        // #414: 수동 싱크는 방금 Garmin 에서 바꾼 과거 활동을 반영하려는 경우가 많다 — 활동만 최근 30일
        activityRecheckDays: ACTIVITY_RECHECK_DAYS,
      });
      const total = results.reduce((s, r) => s + r.synced, 0);
      const failed = results.filter((r) => r.error).length;

      await ctx.reply(
        `✅ 싱크 완료: ${total}건${failed > 0 ? ` (${failed}건 실패)` : ""}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ 싱크 실패: ${msg.slice(0, 200)}`);
    }
  });
}
