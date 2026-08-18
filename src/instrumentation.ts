export async function register() {
  // 서버 사이드에서만 실행 (Edge runtime 제외)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Garmin 싱크 시 다수의 병렬 HTTPS 요청이 동일 TLS 소켓에 error listener를
    // 추가하면서 기본 한도 10을 넘어 MaxListenersExceededWarning 발생.
    // 싱크 중 동시 요청 수 고려하여 여유 있게 상향.
    const { EventEmitter } = await import("events");
    EventEmitter.defaultMaxListeners = 30;

    // #309 (Codex P2 PR #312 2회차): photo temp sweep 을 fallible startup 잡 이전에.
    // startCronJobs 가 malformed SYNC_CRON 등으로 sync throw 하면 이후 라인이 실행 안 됨 →
    // 웹 프로세스 재시작 loop 마다 이전 프로세스 photo 잔존. 봇 프로세스가 별개로 재시작
    // 안 되는 경우 이 sweep 이 유일한 정리 시점. 로컬 fs 만 접근 — 부팅 초기에 안전.
    const { sweepStalePhotoTempFiles } = await import(
      "@/lib/nutrition/photo-temp-cleanup"
    );
    sweepStalePhotoTempFiles().catch((err) => {
      console.error("[photo-cleanup] startup sweep failed:", err);
    });

    const { startCronJobs } = await import("@/lib/cron");
    startCronJobs();

    // M#191: pm2 restart 등으로 orphan 된 pending/running job 을 failed 로 마킹.
    // 부팅 1회 + periodic (5분 주기) 병행. 봇 프로세스도 별도로 호출 (src/bot/standalone.ts).
    const { sweepOrphanedJobs, startOrphanSweeper } = await import(
      "@/lib/report-job"
    );
    sweepOrphanedJobs().catch((err) => {
      console.error("[report-job] sweep failed:", err);
    });
    startOrphanSweeper();
  }
}
