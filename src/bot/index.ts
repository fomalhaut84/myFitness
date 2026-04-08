import { Bot } from "grammy";
import { authMiddleware } from "./middleware/auth";
import { registerStartCommands } from "./commands/start";
import { registerTodayCommand } from "./commands/today";
import { registerRunCommand } from "./commands/run";
import { registerSleepCommand } from "./commands/sleep";
import { registerWeightCommand } from "./commands/weight";
import { registerSyncCommand } from "./commands/sync";
import { registerReportCommand } from "./commands/report";
import { registerAiCommands, handleAiQuestion } from "./commands/ai";
import { isFoodInput, handleFoodInput } from "./commands/food";

export function getBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN 환경변수가 필요합니다.");

  const bot = new Bot(token);

  // 미들웨어
  bot.use(authMiddleware);

  // 커맨드 등록
  registerStartCommands(bot);
  registerTodayCommand(bot);
  registerRunCommand(bot);
  registerSleepCommand(bot);
  registerWeightCommand(bot);
  registerSyncCommand(bot);
  registerReportCommand(bot);
  registerAiCommands(bot);

  // 자연어 fallback
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();

    // 식단 입력 감지
    if (isFoodInput(text)) {
      await handleFoodInput(ctx, text);
      return;
    }

    // 그 외 텍스트 → AI 질문
    await handleAiQuestion(ctx, text);
  });

  return bot;
}
