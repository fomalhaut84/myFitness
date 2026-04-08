import cron from "node-cron";
import { syncAll } from "@/lib/garmin/sync";
import { generateWeeklyReport } from "@/lib/weekly-report";
import { generateMorningReport, generateEveningReport } from "@/lib/daily-report";

let isSyncing = false;
let isRegistered = false;

export function startCronJobs() {
  if (isRegistered) return;
  isRegistered = true;

  // Garmin 싱크 (3시간마다)
  const syncSchedule = process.env.SYNC_CRON ?? "0 6,9,12,15,18,21 * * *";
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
        const todayKST = new Date(nowKST);
        todayKST.setHours(0, 0, 0, 0);

        const twoDaysAgoKST = new Date(nowKST);
        twoDaysAgoKST.setDate(twoDaysAgoKST.getDate() - 2);
        twoDaysAgoKST.setHours(0, 0, 0, 0);

        const results = await syncAll({
          startDate: twoDaysAgoKST,
          endDate: todayKST,
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

  // 모닝 리포트 (매일 08:00 KST)
  const morningSchedule = process.env.MORNING_REPORT_CRON ?? "0 8 * * *";
  console.log(`[cron] 모닝 리포트 등록: ${morningSchedule} (Asia/Seoul)`);

  cron.schedule(
    morningSchedule,
    async () => {
      console.log("[cron] 모닝 리포트 생성 시작");
      try {
        await generateMorningReport();
      } catch (error) {
        console.error("[cron] 모닝 리포트 에러:", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );

  // 이브닝 리포트 (매일 23:00 KST)
  const eveningSchedule = process.env.EVENING_REPORT_CRON ?? "0 23 * * *";
  console.log(`[cron] 이브닝 리포트 등록: ${eveningSchedule} (Asia/Seoul)`);

  cron.schedule(
    eveningSchedule,
    async () => {
      console.log("[cron] 이브닝 리포트 생성 시작");
      try {
        await generateEveningReport();
      } catch (error) {
        console.error("[cron] 이브닝 리포트 에러:", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );

  // 주간 리포트 (매주 월요일 07:00 KST)
  const weeklySchedule = process.env.REPORT_CRON ?? "0 7 * * 1";
  console.log(`[cron] 주간 리포트 등록: ${weeklySchedule} (Asia/Seoul)`);

  cron.schedule(
    weeklySchedule,
    async () => {
      console.log("[cron] 주간 리포트 생성 시작");
      try {
        await generateWeeklyReport();
      } catch (error) {
        console.error("[cron] 주간 리포트 에러:", error);
      }
    },
    { timezone: "Asia/Seoul" }
  );
}
