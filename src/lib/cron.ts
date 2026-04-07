import cron from "node-cron";
import { syncAll } from "@/lib/garmin/sync";
import { generateWeeklyReport } from "@/lib/weekly-report";

let isSyncing = false;
let isRegistered = false;

export function startCronJobs() {
  if (isRegistered) return;
  isRegistered = true;

  // 일일 싱크
  const syncSchedule = process.env.SYNC_CRON ?? "0 6 * * *";
  console.log(`[cron] Garmin 자동 싱크 등록: ${syncSchedule} (Asia/Seoul)`);

  cron.schedule(
    syncSchedule,
    async () => {
      if (isSyncing) {
        console.log("[cron] 싱크 이미 실행 중 — 건너뜀");
        return;
      }

      isSyncing = true;
      console.log("[cron] Garmin 자동 싱크 시작");

      try {
        const nowKST = new Date(
          new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })
        );
        const yesterdayKST = new Date(nowKST);
        yesterdayKST.setDate(yesterdayKST.getDate() - 1);
        yesterdayKST.setHours(0, 0, 0, 0);

        const threeDaysAgoKST = new Date(nowKST);
        threeDaysAgoKST.setDate(threeDaysAgoKST.getDate() - 3);
        threeDaysAgoKST.setHours(0, 0, 0, 0);

        const results = await syncAll({
          startDate: threeDaysAgoKST,
          endDate: yesterdayKST,
        });
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

  // 주간 AI 리포트 (매주 월요일 07:00 KST)
  const reportSchedule = process.env.REPORT_CRON ?? "0 7 * * 1";
  console.log(`[cron] 주간 AI 리포트 등록: ${reportSchedule} (Asia/Seoul)`);

  cron.schedule(
    reportSchedule,
    async () => {
      console.log("[cron] 주간 AI 리포트 생성 시작");
      try {
        await generateWeeklyReport();
      } catch (error) {
        console.error("[cron] 리포트 생성 에러:", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );
}
