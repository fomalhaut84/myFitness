import cron from "node-cron";
import { syncAll } from "@/lib/garmin/sync";

let isSyncing = false;
let isRegistered = false;

export function startCronJobs() {
  if (isRegistered) return;
  isRegistered = true;

  // Garmin 싱크 (3시간마다) — 웹 프로세스에서만 실행
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
        // KST 기준 2일 전 ~ 어제 (당일 데이터 제외 → 미래 날짜 방지)
        const { daysAgoKST, todayKST } = await import("@/lib/garmin/utils");
        const results = await syncAll({
          startDate: daysAgoKST(2),
          endDate: todayKST(),
          // 신규 타입은 2일 윈도우 대신 365일 초기 히스토리 로드
          bootstrapNewTypes: true,
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

  // 리포트 생성은 봇 프로세스(bot/notifications/scheduler.ts)에서 담당
  // 중복 실행 방지를 위해 웹 프로세스에서는 리포트 cron을 등록하지 않음
}
