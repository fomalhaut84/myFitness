import cron from "node-cron";
import { syncAll } from "@/lib/garmin/sync";
import { runFoodKcalBackfill } from "@/lib/nutrition/backfill";
import { listStaleRecalcDates, ackStaleRecalcClaim } from "@/lib/nutrition/stale-recalc";
import { recalculateCalorieBalance } from "@/lib/fitness/calorie-balance";
import { ymdKST } from "@/lib/garmin/utils";
// #269: weather 자동 enrich 는 syncAll 내부 훅 (report pre-sync 등 모든 caller 공유).
// #283 후속 (Codex P1): FoodLog kcal null 재추정 — 봇의 첫 AI 호출이 transient 실패한 경우 회복.
// #283 후속 (Codex P2): recalculateCalorieBalance 가 transient 실패한 date 를 큐에서 이어받아 재시도.

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
        // KST 기준 3일 전 ~ 오늘. 오늘 부분 데이터(체중/혈압/걸음 등)도
        // 자동 갱신 대상에 포함. 미래 날짜는 각 fetcher의 calendarDate 가드가 차단.
        // #328: 2 → 3일로 window 확장. Garmin API 가 늦게 sync 되는 데이터 (체중 등)
        // margin 확보. upsert 라 중복 저장 없음.
        const { daysAgoKST, todayKST } = await import("@/lib/garmin/utils");
        const results = await syncAll({
          startDate: daysAgoKST(3),
          endDate: todayKST(),
          // 신규 타입은 3일 윈도우 대신 365일 초기 히스토리 로드
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

        // #283 Codex P2: 큐에 남은 stale-recalc date 재시도. list → 개별 recalc → 성공만 ack.
        // 실패 date 는 큐에 그대로 남아 다음 tick 이 이어받음 (프로세스 중단 시에도 소실 없음).
        // Codex P2 (claim vs new mark): ack 는 claim 시점 (lastAlertAt) 이후 새 mark 가 없을 때만
        // 삭제 — recalc 중 다른 producer 가 upsert 로 signal 갱신했으면 그 signal 보존.
        try {
          const claims = await listStaleRecalcDates();
          for (const c of claims) {
            // #364: c.date 는 KST 자정 instant. UTC 절단은 로그 날짜를 하루 앞으로
            // 밀어 장애 진단 시 오독을 유발한다.
            const key = ymdKST(c.date);
            try {
              await recalculateCalorieBalance(c.date, undefined);
              const deleted = await ackStaleRecalcClaim(c);
              if (deleted === 0) {
                console.log(
                  `[cron] stale recalc 성공: ${key} (처리 중 새 signal 발생 — 다음 tick 재시도)`,
                );
              } else {
                console.log(`[cron] stale recalc 성공: ${key}`);
              }
            } catch (recalcErr) {
              console.error(`[cron] stale recalc 재실패 (${key}):`, recalcErr);
              // ack 안 함 → 큐에 계속 남음 → 다음 tick 재시도.
            }
          }
        } catch (err) {
          console.error("[cron] stale recalc 처리 에러:", err);
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
