// #397 F2: 러닝 활동 조회 1회 — 4 패널이 같은 배열을 쓴다. 서버 전용 (prisma). 캐시 래퍼는 `history/cache.ts`.
import prisma from "@/lib/prisma";
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";
import type { ZoneDistribution } from "@/lib/fitness/intensity";
import { RACE_EVENT_TYPE } from "@/lib/garmin/parse-event-type";
import { ymdKST } from "@/lib/garmin/utils";
import { kstDayRange } from "@/lib/history/buckets";
import type { InsightContext, InsightRun } from "./types";

function toZones(raw: unknown): ZoneDistribution | null {
  if (!raw || typeof raw !== "object") return null;
  const z = raw as Record<string, unknown>;
  const pick = (k: string) => (typeof z[k] === "number" && Number.isFinite(z[k] as number) ? (z[k] as number) : 0);
  const zones = { z1: pick("z1"), z2: pick("z2"), z3: pick("z3"), z4: pick("z4"), z5: pick("z5") };
  return zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5 > 0 ? zones : null;
}

export async function loadInsightRuns(ctx: InsightContext): Promise<InsightRun[]> {
  const rows = await prisma.activity.findMany({
    where: {
      AND: [
        RUNNING_ACTIVITY_WHERE,
        { startTime: { gte: kstDayRange(ctx.lowerBound).start, lt: kstDayRange(ctx.today).end }, distance: { gt: 0 }, avgPace: { gt: 0 } },
      ],
    },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      startTime: true,
      distance: true,
      duration: true,
      avgPace: true,
      avgHR: true,
      weatherTempC: true,
      weatherHumidityPct: true,
      zoneDistribution: true,
      eventType: true,
    },
  });
  return rows.map((r) => {
    const ymd = ymdKST(r.startTime);
    return {
      id: r.id,
      ymd,
      year: Number(ymd.slice(0, 4)),
      distanceM: r.distance as number,
      durationSec: r.duration,
      avgPace: r.avgPace as number,
      avgHR: r.avgHR,
      tempC: r.weatherTempC,
      humidityPct: r.weatherHumidityPct,
      zones: toZones(r.zoneDistribution),
      race: r.eventType === RACE_EVENT_TYPE,
    };
  });
}
