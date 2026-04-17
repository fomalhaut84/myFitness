import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await prisma.userProfile.findFirst();
  return (
    <ProfileClient
      initial={{
        name: profile?.name ?? "사용자",
        // 서버 로컬 midnight으로 저장된 값 → 로컬 타임존 기준 YYYY-MM-DD 추출
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
    />
  );
}
