import "dotenv/config";
import { getBot } from "./index";
import { startBotScheduler } from "./notifications/scheduler";
import { sanitizeError } from "./utils/error";

async function main() {
  console.log("[bot] myFitness 텔레그램 봇 시작...");

  const bot = getBot();

  // update handler 에러 격리 — handler 안 throw가 process 죽이지 않도록.
  bot.catch((err) => {
    console.error(`[bot] update handler 에러: ${sanitizeError(err)}`);
  });

  await bot.init();
  console.log(`[bot] @${bot.botInfo.username} 초기화 완료`);

  // 웹훅 해제 (long polling 모드)
  await bot.api.deleteWebhook();

  // 알림 스케줄러 시작
  startBotScheduler(bot);

  // Long polling 시작. start()가 반환하는 Promise는 long-poll loop 전체 lifecycle을 감싸고
  // fetchUpdates에서 401/409 등이 발생하면 reject됨. catch 없으면 unhandledRejection → PM2 crash.
  // 명시적 catch로 잡아 로깅 후 깔끔히 종료 → PM2 autorestart가 새 프로세스 시작.
  bot
    .start({
      onStart: () => console.log("[bot] Long polling 시작"),
    })
    .catch((err) => {
      console.error(`[bot] Long polling 비정상 종료: ${sanitizeError(err)}`);
      process.exit(1);
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

// 최후 안전망: missed promise reject / sync throw가 PM2 crash로 떨어지지 않도록.
// 토큰 마스킹된 로그 남기고, 회복 가능성 차이로 unhandledRejection은 로깅만, uncaughtException은 종료.
process.on("unhandledRejection", (reason) => {
  console.error(`[bot] unhandledRejection: ${sanitizeError(reason)}`);
});
process.on("uncaughtException", (err) => {
  console.error(`[bot] uncaughtException: ${sanitizeError(err)}`);
  process.exit(1);
});

main().catch((error) => {
  console.error(`[bot] 시작 실패: ${sanitizeError(error)}`);
  process.exit(1);
});
