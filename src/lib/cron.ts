import cron from "node-cron";
import { syncAll } from "@/lib/garmin/sync";

let isSyncing = false;
let isRegistered = false;

export function startCronJobs() {
  if (isRegistered) return;
  isRegistered = true;

  const schedule = process.env.SYNC_CRON ?? "0 6 * * *";

  console.log(`[cron] Garmin 자동 싱크 등록: ${schedule} (Asia/Seoul)`);

  cron.schedule(
    schedule,
    async () => {
      if (isSyncing) {
        console.log("[cron] 싱크 이미 실행 중 — 건너뜀");
        return;
      }

      isSyncing = true;
      console.log("[cron] Garmin 자동 싱크 시작");

      try {
        const results = await syncAll();
        const total = results.reduce((sum, r) => sum + r.synced, 0);
        const failed = results.filter((r) => r.error).length;
        console.log(`[cron] 싱크 완료: ${total}건, 실패 ${failed}건`);
      } catch (error) {
        console.error("[cron] 싱크 에러:", error);
      } finally {
        isSyncing = false;
      }
    },
    { timezone: "Asia/Seoul" }
  );
}
