import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [profile, history] = await Promise.all([
    prisma.userProfile.findFirst(),
    prisma.metricChange.findMany({
      orderBy: { changedAt: "desc" },
      take: 50,
    }),
  ]);

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
      }}
      garminMeta={{
        maxHRSource: profile?.maxHRSource ?? null,
        lthrSource: profile?.lthrSource ?? null,
        lthrAutoDetected: profile?.lthrAutoDetected ?? null,
        vo2maxRunning: profile?.vo2maxRunning ?? null,
        garminSyncedAt: profile?.garminSyncedAt
          ? profile.garminSyncedAt.toISOString()
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
