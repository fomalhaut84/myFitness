export async function register() {
  // 서버 사이드에서만 실행 (Edge runtime 제외)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCronJobs } = await import("@/lib/cron");
    startCronJobs();
  }
}
