import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import { extractGarminZoneValues } from "@/lib/garmin/profile-values";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [profile, history, latestLthrPace] = await Promise.all([
    prisma.userProfile.findFirst(),
    prisma.metricChange.findMany({
      orderBy: { changedAt: "desc" },
      take: 50,
    }),
    // #505: Garmin 최신 LT 페이스 (#378 이력 — 감지일만 row) · 수동 보호 중인 값과 비교용
    prisma.fitnessMetricDaily.findFirst({
      where: { lthrPace: { not: null } },
      orderBy: { date: "desc" },
      select: { lthrPace: true, date: true },
    }),
  ]);
  // #505: 러닝 존 원본은 매 싱크 갱신 (수동 보호와 무관) → 현재 Garmin maxHR · LTHR
  const garminZone = extractGarminZoneValues(profile?.heartRateZonesRaw ?? null);

  return (
    <ProfileClient
      initial={{
        name: profile?.name ?? "사용자",
        birthDate: profile?.birthDate ? formatDateLocal(profile.birthDate) : "",
        height: profile?.height ?? null,
        targetWeight: profile?.targetWeight ?? null,
        targetDate: profile?.targetDate
          ? formatDateLocal(profile.targetDate)
          : "",
        restingHRBase: profile?.restingHRBase ?? null,
        maxHR: profile?.maxHR ?? null,
        lthr: profile?.lthr ?? null,
        lthrPace: profile?.lthrPace ?? null,
        targetCalories: profile?.targetCalories ?? null,
        // M12 (#223): 개인 목표
        targetAvgPace: profile?.targetAvgPace ?? null,
        targetWeeklyKm: profile?.targetWeeklyKm ?? null,
        targetVO2max: profile?.targetVO2max ?? null,
        personalGoalNote: profile?.personalGoalNote ?? "",
        // M13 Phase 1 (#243): autoAdjust 사전 알림 활성 여부 (DEFAULT true).
        autoAdjustEnabled: profile?.autoAdjustEnabled ?? true,
      }}
      garminMeta={{
        maxHRSource: profile?.maxHRSource ?? null,
        lthrSource: profile?.lthrSource ?? null,
        lthrAutoDetected: profile?.lthrAutoDetected ?? null,
        vo2maxRunning: profile?.vo2maxRunning ?? null,
        garminSyncedAt: profile?.garminSyncedAt
          ? profile.garminSyncedAt.toISOString()
          : null,
        current: {
          maxHR: profile?.maxHR ?? null,
          lthr: profile?.lthr ?? null,
          lthrPace: profile?.lthrPace ?? null,
        },
        garmin: {
          maxHR: garminZone.maxHR,
          lthr: garminZone.lthr,
        },
        // 감지 이력 값 — 싱크가 쓰는 user-settings 현재값과 다를 수 있어 날짜와 함께 따로 표시 (사전 리뷰 major 1)
        ltDetection: latestLthrPace?.lthrPace
          ? { pace: latestLthrPace.lthrPace, date: formatDateLocal(latestLthrPace.date) }
          : null,
      }}
      metricHistory={history.map((h) => ({
        id: h.id,
        field: h.field,
        oldValue: h.oldValue,
        newValue: h.newValue,
        source: h.source,
        reason: h.reason,
        changedAt: h.changedAt.toISOString(),
      }))}
    />
  );
}
