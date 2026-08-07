import cron from "node-cron";
import { syncAll } from "@/lib/garmin/sync";
import { runFoodKcalBackfill } from "@/lib/nutrition/backfill";
// #269: weather 자동 enrich 는 syncAll 내부 훅 (report pre-sync 등 모든 caller 공유).
// #283 후속 (Codex P1): FoodLog kcal null 재추정 — 봇의 첫 AI 호출이 transient 실패한 경우 회복.

const FOOD_KCAL_LIMIT_PER_TICK = 20;

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
        // KST 기준 2일 전 ~ 오늘. 오늘 부분 데이터(체중/혈압/걸음 등)도
        // 자동 갱신 대상에 포함. 미래 날짜는 각 fetcher의 calendarDate 가드가 차단.
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
        // weather 자동 enrich 는 syncAll 내부에서 실행됨 (#269 후속).

        // #283 Codex P1: FoodLog kcal null 재추정. transient 실패로 남은 null 을 다음 sync tick 에서 회복.
        try {
          const foodRes = await runFoodKcalBackfill({ limit: FOOD_KCAL_LIMIT_PER_TICK });
          if (foodRes.candidates > 0) {
            console.log(
              `[cron] food kcal backfill: 대상 ${foodRes.candidates}, 성공 ${foodRes.ok}, 실패 ${foodRes.failed}`,
            );
          }
        } catch (err) {
          console.error("[cron] food kcal backfill 에러:", err);
        }
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
