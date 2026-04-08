import type { Bot } from "grammy";
import prisma from "../prisma";
import { mdToHtml, replyLong } from "../utils/telegram";

export function registerReportCommand(bot: Bot) {
  bot.command("report", async (ctx) => {
    const latest = await prisma.aIAdvice.findFirst({
      where: { category: { in: ["morning_report", "evening_report", "weekly_report"] } },
      orderBy: { createdAt: "desc" },
      select: { category: true, reportDate: true, response: true },
    });

    if (!latest) {
      await ctx.reply("리포트가 아직 없습니다.");
      return;
    }

    const typeLabels: Record<string, string> = {
      morning_report: "☀️ 모닝 리포트",
      evening_report: "🌙 이브닝 리포트",
      weekly_report: "📊 주간 리포트",
    };

    const header = `<b>${typeLabels[latest.category] ?? latest.category}</b>`;
    const date = latest.reportDate ? ` (${latest.reportDate})` : "";
    const html = mdToHtml(latest.response);

    await replyLong(ctx, `${header}${date}\n\n${html}`, true);
  });
}
