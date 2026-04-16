import prisma from "@/lib/prisma";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await prisma.userProfile.findFirst();
  return (
    <ProfileClient
      initial={{
        name: profile?.name ?? "사용자",
        birthDate: profile?.birthDate
          ? profile.birthDate.toISOString().slice(0, 10)
          : "",
        height: profile?.height ?? null,
        targetWeight: profile?.targetWeight ?? null,
        targetDate: profile?.targetDate
          ? profile.targetDate.toISOString().slice(0, 10)
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
