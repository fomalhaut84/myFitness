export async function register() {
  // 서버 사이드에서만 실행 (Edge runtime 제외)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Garmin 싱크 시 다수의 병렬 HTTPS 요청이 동일 TLS 소켓에 error listener를
    // 추가하면서 기본 한도 10을 넘어 MaxListenersExceededWarning 발생.
    // 싱크 중 동시 요청 수 고려하여 여유 있게 상향.
    const { EventEmitter } = await import("events");
    EventEmitter.defaultMaxListeners = 30;

    const { startCronJobs } = await import("@/lib/cron");
    startCronJobs();
  }
}
