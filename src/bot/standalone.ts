import "dotenv/config";
import { getBot } from "./index";
import { startBotScheduler } from "./notifications/scheduler";

async function main() {
  console.log("[bot] myFitness 텔레그램 봇 시작...");

  const bot = getBot();

  await bot.init();
  console.log(`[bot] @${bot.botInfo.username} 초기화 완료`);

  // 웹훅 해제 (long polling 모드)
  await bot.api.deleteWebhook();

  // 알림 스케줄러 시작
  startBotScheduler(bot);

  // Long polling 시작
  bot.start({
    onStart: () => console.log("[bot] Long polling 시작"),
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("[bot] 종료 중...");
    bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[bot] 시작 실패:", error);
  process.exit(1);
});
