import type { Bot } from "grammy";
import prisma from "../prisma";

export function registerWeightCommand(bot: Bot) {
  bot.command("weight", async (ctx) => {
    const recent = await prisma.bodyComposition.findMany({
      orderBy: { date: "desc" },
      take: 5,
      select: { date: true, weight: true, bodyFat: true },
    });

    if (recent.length === 0) {
      await ctx.reply("체중 기록이 없습니다.");
      return;
    }

    const lines = ["⚖️ <b>체중 추세</b>\n"];
    for (const r of recent) {
      const date = r.date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
      const fat = r.bodyFat ? ` · ${r.bodyFat.toFixed(1)}%` : "";
      lines.push(`${date}: <b>${r.weight.toFixed(1)}</b> kg${fat}`);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
