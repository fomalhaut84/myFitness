import { Bot } from "grammy";
import { Agent } from "https";
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

// IPv6 라우트가 없는 환경(국내 ISP 등)에서 node-fetch의 IPv6 우선 시도가
// ETIMEDOUT으로 누적되는 것을 방지하기 위해 IPv4 강제. keepAlive로 cron 호출 시
// TCP/TLS 핸드셰이크 비용도 절감. 자세한 배경은 docs/specs/bot-telegram-ipv6-timeout-202606.md 참조.
const telegramAgent = new Agent({ family: 4, keepAlive: true });

export function getBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN 환경변수가 필요합니다.");

  const bot = new Bot(token, {
    client: {
      baseFetchConfig: { agent: telegramAgent },
      timeoutSeconds: 30,
    },
  });

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
