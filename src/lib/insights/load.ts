// #397 F2: 러닝 활동 조회 1회 — 4 패널이 같은 배열을 쓴다. 서버 전용 (prisma). 캐시 래퍼는 `history/cache.ts`.
import prisma from "@/lib/prisma";
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";
import { toComparableZones, type ZoneDistribution } from "@/lib/fitness/intensity";
import { INTENSITY_SELECT, selectIntensity } from "@/lib/fitness/intensity-select";
import { loadIntensityContext } from "@/lib/fitness/intensity-setting";
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

function comparable(zones: ZoneDistribution | null, basis: "hr" | "power" | null): ZoneDistribution | null {
  return zones === null ? null : toComparableZones(zones, basis);
}

export async function loadInsightRuns(ctx: InsightContext): Promise<InsightRun[]> {
  const basis = await loadIntensityContext(prisma);
  const rows = await prisma.activity.findMany({
    where: {
      AND: [
        RUNNING_ACTIVITY_WHERE,
        // 거리 · 페이스 조건은 넣지 않는다 — 존 패널은 GPS 없는 트레드밀 러닝도 센다 (PR #417 Codex P2). 산점도는 `usableRuns` 가 거른다
        { startTime: { gte: kstDayRange(ctx.lowerBound).start, lt: kstDayRange(ctx.today).end } },
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
      // #570: 존 분포는 프로필 강도 기준 (심박 / 파워 / 자동) 값
      ...INTENSITY_SELECT,
      weatherApparentTempC: true,
      eventType: true,
      hrr2: true,
    },
  });
  return rows.map((r) => {
    const ymd = ymdKST(r.startTime);
    const intensity = selectIntensity(r, basis);
    return {
      id: r.id,
      ymd,
      year: Number(ymd.slice(0, 4)),
      distanceM: r.distance !== null && r.distance > 0 ? r.distance : null,
      durationSec: r.duration,
      avgPace: r.avgPace !== null && r.avgPace > 0 ? r.avgPace : null,
      avgHR: r.avgHR,
      tempC: r.weatherTempC,
      humidityPct: r.weatherHumidityPct,
      // #570: 월별 존 비율은 기준이 섞이므로 파워 존을 심박 등가로 (toComparableZones)
      zones: comparable(toZones(intensity.zoneDistribution), intensity.basis),
      zoneBasis: intensity.basis,
      race: r.eventType === RACE_EVENT_TYPE,
      hrr2: r.hrr2,
    };
  });
}
