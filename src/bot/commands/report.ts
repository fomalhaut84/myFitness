import type { Bot } from "grammy";
import prisma from "../prisma";
import { mdToHtml, replyLong } from "../utils/telegram";
import { generateMorningReport, generateEveningReport } from "../../lib/daily-report";

export function registerReportCommand(bot: Bot) {
  bot.command("report", async (ctx) => {
    const arg = ctx.match?.toString().trim().toLowerCase();

    // /report regenerate morning|evening
    if (arg?.startsWith("regenerate")) {
      const type = arg.split(/\s+/)[1];
      if (type === "morning" || type === "evening") {
        await ctx.reply(`🔄 ${type === "morning" ? "모닝" : "이브닝"} 리포트 재생성 중...`);
        try {
          const result = type === "morning"
            ? await generateMorningReport(true)
            : await generateEveningReport(true);
          const html = mdToHtml(result);
          await replyLong(ctx, `✅ 재생성 완료\n\n${html}`, true);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await ctx.reply(`❌ 재생성 실패: ${msg.slice(0, 200)}`);
        }
        return;
      }
      await ctx.reply("사용법: /report regenerate morning|evening");
      return;
    }

    // 최근 리포트 표시
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
