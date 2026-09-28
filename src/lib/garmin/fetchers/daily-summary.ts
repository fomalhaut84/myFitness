import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { recalculateCalorieBalance, recalculateAllCalorieBalances } from "@/lib/fitness/calorie-balance";
import { dateRange, formatDate, startOfDay, todayKSTString, withRateLimit } from "../utils";
import { isEmptyDailySummary, isPrivacyProtected } from "../empty-day";
import { evictPersistedToken } from "../client";

const DAILY_SUMMARY_URL =
  "https://connectapi.garmin.com/usersummary-service/usersummary/daily";

export async function syncDailySummaries(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  let skippedEmpty = 0;
  let latestCalorieGoal: number | null = null;
  const dates = dateRange(startDate, endDate);

  try {
    for (const date of dates) {
      try {
        const dateStr = formatDate(date);
        const summary = await withRateLimit(() =>
          client.get<Record<string, unknown>>(
            `${DAILY_SUMMARY_URL}?calendarDate=${dateStr}`
          )
        );

        if (!summary) continue;

        // #383 A11: privacyProtected=true 는 데이터 없음이 아니라 토큰/권한 이상 — stub 저장 대신 싱크 실패.
        // calendarDate 가드보다 앞 (사전 리뷰 major 1: 마스킹된 응답은 calendarDate 도 없을 수 있어 뒤에 두면 조용히 skip).
        // 메시지의 "unauthorized" 는 admin-alerts 의 isGarminAuthError 패턴에 걸려 기존 인증 실패 알림 경로를 탄다 (info 1).
        // Codex P2 (PR #387): status 403 을 실어 withReauth 가 캐시 클라이언트를 버리고 재인증 후 1회 재시도하게 한다 —
        // plain Error 면 같은 토큰을 계속 재사용해 매 싱크 같은 날짜에서 멈춘다.
        // 2회차 P2: 메모리만 비우면 authenticate() 가 같은 .garmin-tokens 를 다시 읽는다 → 영속 토큰을 지워 비밀번호 로그인 유도.
        if (isPrivacyProtected(summary)) {
          evictPersistedToken();
          throw privacyProtectedError(dateStr);
        }

        if (!summary.calendarDate) continue;

        // Garmin calendarDate가 오늘(KST) 이후면 건너뛰기 (미래 날짜 방지)
        if (String(summary.calendarDate) > todayKSTString()) continue;

        // #383: 워치 미착용 날(핵심 지표 전부 null/0)은 빈 stub 을 만들지 않는다 (rawData 도 남기지 않음).
        if (isEmptyDailySummary(summary)) {
          skippedEmpty++;
          continue;
        }

        const dayDate = startOfDay(date);
        const moderate = toInt(summary.moderateIntensityMinutes);
        const vigorous = toInt(summary.vigorousIntensityMinutes);
        const intensityMin =
          moderate !== null || vigorous !== null
            ? (moderate ?? 0) + (vigorous ?? 0)
            : null;

        const data = {
          steps: toInt(summary.totalSteps),
          totalCalories: toInt(summary.totalKilocalories),
          activeCalories: toInt(summary.activeKilocalories),
          restingHR: toInt(summary.restingHeartRate),
          avgStress: toInt(summary.averageStressLevel),
          bodyBattery: toInt(summary.bodyBatteryMostRecentValue),
          bodyBatteryHigh: toInt(summary.bodyBatteryHighestValue),
          bodyBatteryLow: toInt(summary.bodyBatteryLowestValue),
          intensityMin,
          floorsClimbed: toInt(summary.floorsAscended),
          // M2: 추가 지표
          avgSpo2: toFloat(summary.averageSpo2),
          lowestSpo2: toFloat(summary.lowestSpo2),
          avgRespiration: toFloat(summary.avgWakingRespirationValue),
          stressHighDuration: toMinutes(summary.highStressDuration),
          stressMediumDuration: toMinutes(summary.mediumStressDuration),
          stressLowDuration: toMinutes(summary.lowStressDuration),
          bodyBatteryCharged: toInt(summary.bodyBatteryChargedValue),
          bodyBatteryDrained: toInt(summary.bodyBatteryDrainedValue),
          rawData: summary as Prisma.InputJsonValue,
        };

        // M4-3: 최신 날짜의 netCalorieGoal을 기억 (루프 후 한 번만 프로필에 반영)
        // 프로필 API와 동일한 범위(500~5000 kcal)를 적용하여 비정상 값 차단.
        const garminGoal = toInt(summary.netCalorieGoal);
        if (garminGoal && garminGoal >= 500 && garminGoal <= 5000) {
          latestCalorieGoal = garminGoal;
        }

        await prisma.dailySummary.upsert({
          where: { date: dayDate },
          update: data,
          create: { date: dayDate, ...data },
        });

        // M4-2: 칼로리 밸런스 재계산 (targetCalories + activeCalories, 섭취와 비교).
        // 재계산 실패는 싱크 전체를 실패시키지 않음 (다음 싱크에서 자연 복구).
        try {
          await recalculateCalorieBalance(dayDate);
        } catch (err) {
          console.error(
            `[daily-summary] 칼로리 밸런스 재계산 실패 (${formatDate(dayDate)}):`,
            err instanceof Error ? err.message : String(err)
          );
        }

        synced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("404") || msg.includes("not found")) continue;
        throw error;
      }
    }
  } finally {
    // 사전 리뷰 info 3: 중간에 throw 돼도 그때까지의 skip 건수는 남긴다 (진단용).
    if (skippedEmpty > 0) {
      console.log(`[daily-summary] 빈 날(워치 미착용) ${skippedEmpty}건 skip`);
    }
  }

  // M4-3: 싱크 완료 후, 최신 날짜의 netCalorieGoal을 UserProfile.targetCalories에 반영.
  // 사용자가 프로필에서 직접 설정한 값이 없을 때만 (수동값 우선).
  // 반영 후 싱크된 날짜들의 칼로리 밸런스를 재계산 (targetCalories가 null→값으로 바뀌었으므로).
  if (latestCalorieGoal !== null) {
    try {
      // 프로필 row가 없으면 생성 (singleton upsert).
      await prisma.userProfile.upsert({
        where: { singleton: true },
        update: {},
        create: { singleton: true, name: "사용자" },
      });
      // 원자적 조건부 업데이트: targetCalories가 null인 경우에만 덮어쓰기.
      const updated = await prisma.userProfile.updateMany({
        where: { targetCalories: null },
        data: { targetCalories: latestCalorieGoal },
      });
      if (updated.count > 0) {
        // targetCalories가 방금 세팅됨 → 모든 DailySummary의 밸런스가 stale.
        // fire-and-forget으로 전체 히스토리 재계산 (프로필 PATCH와 동일 전략).
        recalculateAllCalorieBalances().catch((err) => {
          console.error(
            "[daily-summary] targetCalories 자동 설정 후 재계산 실패:",
            err instanceof Error ? err.message : String(err)
          );
        });
      }
    } catch (err) {
      // 프로필 업데이트 실패는 싱크를 중단하지 않지만 로그는 남김
      console.error(
        "[daily-summary] Garmin netCalorieGoal → targetCalories 자동 반영 실패:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return synced;
}

/** privacyProtected 응답 → 403 상태를 가진 인증 오류 (withReauth 재인증 · isGarminAuthError 알림 둘 다 status 로 판정). */
function privacyProtectedError(dateStr: string): Error & { status: number } {
  return Object.assign(
    new Error(
      `Garmin daily summary ${dateStr} 응답 privacyProtected=true — unauthorized (403): 인증/토큰 권한 이상 (A11)`
    ),
    { status: 403 }
  );
}

function toInt(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n);
}

function toFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

/** Garmin은 스트레스 시간을 초 단위로 반환 → 분으로 변환 */
function toMinutes(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n / 60);
}
