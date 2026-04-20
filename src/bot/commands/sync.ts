import type { Bot } from "grammy";
import { syncAll } from "../../lib/garmin/sync";

export function registerSyncCommand(bot: Bot) {
  bot.command("sync", async (ctx) => {
    await ctx.reply("🔄 Garmin 데이터 싱크 시작...");

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const results = await syncAll({ startDate: yesterday, endDate: today });
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
