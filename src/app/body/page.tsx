import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import BodyClient from "./body-client";

export const dynamic = "force-dynamic";

function daysAgoLocal(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function BodyPage() {
  const thirtyDaysAgo = daysAgoLocal(30);

  const [latest, weightTrend, fatTrend, recentRecords] = await Promise.all([
    prisma.bodyComposition.findFirst({ orderBy: { date: "desc" } }),
    prisma.bodyComposition.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      select: { date: true, weight: true },
      orderBy: { date: "asc" },
    }),
    prisma.bodyComposition.findMany({
      where: { date: { gte: thirtyDaysAgo }, bodyFat: { not: null } },
      select: { date: true, bodyFat: true },
      orderBy: { date: "asc" },
    }),
    prisma.bodyComposition.findMany({
      where: { date: { gte: daysAgoLocal(14) } },
      orderBy: { date: "desc" },
      select: {
        date: true,
        weight: true,
        bmi: true,
        bodyFat: true,
        muscleMass: true,
      },
    }),
  ]);

  return (
    <BodyClient
      latestWeight={latest?.weight ?? null}
      latestBMI={latest?.bmi ?? null}
      latestBodyFat={latest?.bodyFat ?? null}
      weightTrend={weightTrend.map((r) => ({
        date: formatDateLocal(r.date),
        value: r.weight,
      }))}
      fatTrend={fatTrend.map((r) => ({
        date: formatDateLocal(r.date),
        value: r.bodyFat,
      }))}
      recentRecords={recentRecords.map((r) => ({
        date: formatDateLocal(r.date),
        weight: r.weight,
        bmi: r.bmi,
        bodyFat: r.bodyFat,
        muscleMass: r.muscleMass,
      }))}
    />
  );
}
