import type { Bot } from "grammy";
import prisma from "../prisma";
import { fmtSleepTime, fmtTime } from "../utils/formatter";

export function registerSleepCommand(bot: Bot) {
  bot.command("sleep", async (ctx) => {
    const recent = await prisma.sleepRecord.findFirst({
      orderBy: { date: "desc" },
    });

    if (!recent) {
      await ctx.reply("수면 기록이 없습니다.");
      return;
    }

    const lines = ["😴 <b>최근 수면</b>\n"];
    lines.push(`📅 ${recent.date.toLocaleDateString("ko-KR")}`);
    lines.push(`⏰ ${fmtTime(recent.sleepStart.toISOString())} → ${fmtTime(recent.sleepEnd.toISOString())}`);
    lines.push(`⏱ 총 ${fmtSleepTime(recent.totalSleep)}`);

    if (recent.sleepScore !== null) lines.push(`📊 점수: <b>${recent.sleepScore}</b>`);
    if (recent.deepSleep !== null) lines.push(`🔵 깊은 수면: ${fmtSleepTime(recent.deepSleep)}`);
    if (recent.remSleep !== null) lines.push(`🟣 REM: ${fmtSleepTime(recent.remSleep)}`);
    if (recent.lightSleep !== null) lines.push(`⚪ 얕은 수면: ${fmtSleepTime(recent.lightSleep)}`);
    if (recent.avgSpO2 !== null) lines.push(`🫁 SpO2: ${recent.avgSpO2}%`);
    if (recent.hrvOvernight !== null) lines.push(`💓 HRV: ${Math.round(recent.hrvOvernight)} ms`);
    if (recent.bodyBatteryChange !== null) lines.push(`🔋 배터리 충전: +${recent.bodyBatteryChange}`);

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
