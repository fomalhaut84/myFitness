import type { Bot } from "grammy";
import prisma from "../prisma";
import { fmtDistance, fmtPace, fmtDuration } from "../utils/formatter";

export function registerRunCommand(bot: Bot) {
  bot.command("run", async (ctx) => {
    const recent = await prisma.activity.findMany({
      where: { activityType: { contains: "running" } },
      orderBy: { startTime: "desc" },
      take: 3,
      select: {
        name: true,
        startTime: true,
        duration: true,
        distance: true,
        avgPace: true,
        avgHR: true,
        trainingEffect: true,
      },
    });

    if (recent.length === 0) {
      await ctx.reply("최근 러닝 기록이 없습니다.");
      return;
    }

    const lines = ["🏃 <b>최근 러닝</b>\n"];

    for (const r of recent) {
      const date = r.startTime.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
      lines.push(
        `<b>${r.name}</b> (${date})`,
        `  ${fmtDistance(r.distance)} · ${fmtDuration(r.duration)} · ${fmtPace(r.avgPace)}`,
        r.avgHR ? `  ❤️ ${r.avgHR} bpm${r.trainingEffect ? ` · TE ${r.trainingEffect.toFixed(1)}` : ""}` : "",
        ""
      );
    }

    await ctx.reply(lines.filter(Boolean).join("\n"), { parse_mode: "HTML" });
  });
}
