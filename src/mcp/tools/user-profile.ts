import prisma from "../prisma";
import {
  garminZoneRanges,
  getZoneRanges,
  resolveMaxHR,
  type GarminZonesRaw,
} from "@/lib/fitness/zones";
import { formatDateLocal } from "@/lib/format";

const FIELD_LABELS: Record<string, string> = {
  maxHR: "최대 심박",
  lthr: "젖산역치 심박",
  lthrPace: "LTHR 페이스",
  vo2maxRunning: "VO2max",
  restingHRBase: "안정시 심박",
};

function fmtPace(secPerKm: number | null): string | null {
  if (!secPerKm || secPerKm <= 0) return null;
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}/km`;
}

export async function getUserProfile() {
  const profile = await prisma.userProfile.findFirst();
  if (!profile) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            _context: "프로필 미설정. /settings/profile에서 입력하세요.",
          }),
        },
      ],
    };
  }

  // Activity MAX HR fallback
  const activityMax = await prisma.activity.aggregate({
    _max: { maxHR: true },
  });
  const activityMaxHR = activityMax._max.maxHR;

  // maxHR 결정. profile.maxHR 있으면 source 추론 (NULL은 manual로 간주).
  let maxHRValue: number;
  let maxHRSource: "manual" | "garmin" | "activity" | "estimated";
  if (profile.maxHR) {
    maxHRValue = profile.maxHR;
    maxHRSource = profile.maxHRSource === "garmin" ? "garmin" : "manual";
  } else if (activityMaxHR) {
    maxHRValue = activityMaxHR;
    maxHRSource = "activity";
  } else {
    maxHRValue = resolveMaxHR(profile);
    maxHRSource = "estimated";
  }

  // Zone 결정:
  // - maxHR/lthr 둘 다 Garmin source일 때만 Garmin zone1~5Floor 사용
  // - manual override 또는 zonesRaw가 현재 maxHR/lthr와 불일치(stale)면 calculated로 fallback
  //   (heartRateZones 실패 + user-settings 통한 lthr 갱신 등으로 zonesRaw가 뒤쳐진 경우)
  const bothGarminOwned =
    profile.maxHRSource === "garmin" && profile.lthrSource === "garmin";
  const rawZones = profile.heartRateZonesRaw as unknown as
    | (GarminZonesRaw & { lactateThresholdHeartRateUsed?: number | null })
    | null;
  const zonesRawFresh =
    rawZones !== null &&
    rawZones.maxHeartRateUsed === profile.maxHR &&
    rawZones.lactateThresholdHeartRateUsed === profile.lthr;
  const garminZones =
    bothGarminOwned && zonesRawFresh && rawZones
      ? garminZoneRanges(rawZones)
      : null;
  const lthrValue =
    profile.lthr && profile.lthr > 0
      ? profile.lthr
      : Math.round(maxHRValue * 0.9);
  const zones = garminZones ?? getZoneRanges(lthrValue, maxHRValue);
  const zoneSource: "garmin" | "calculated" = garminZones ? "garmin" : "calculated";

  const response = {
    _context:
      "사용자 프로필 + Garmin 자동 동기화된 maxHR/LTHR/Zone. " +
      "각 값에 source가 표시됨 (manual=사용자 수동, garmin=자동, activity=DB 추정, estimated=공식).",
    name: profile.name,
    // 날짜는 로컬 기준으로 직렬화 (toISOString은 UTC 변환으로 ±1일 어긋남 가능)
    birthDate: profile.birthDate ? formatDateLocal(profile.birthDate) : null,
    maxHR: { value: maxHRValue, source: maxHRSource },
    lthr: profile.lthr
      ? {
          value: profile.lthr,
          source: profile.lthrSource ?? "manual",
          autoDetected: profile.lthrAutoDetected ?? false,
          measuredAt: profile.lthrMeasuredAt?.toISOString() ?? null,
        }
      : null,
    lthrPace: profile.lthrPace
      ? {
          value: profile.lthrPace,
          formatted: fmtPace(profile.lthrPace),
          // pace는 LTHR과 한 쌍으로 측정되므로 lthrSource를 따름
          source: profile.lthrSource ?? "manual",
        }
      : null,
    vo2maxRunning: profile.vo2maxRunning,
    restingHR: profile.restingHRBase,
    targetWeight: profile.targetWeight,
    targetCalories: profile.targetCalories,
    targetDate: profile.targetDate ? formatDateLocal(profile.targetDate) : null,
    heartRateZones: zones,
    zoneSource,
    garminSyncedAt: profile.garminSyncedAt?.toISOString() ?? null,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

export async function getMetricHistory(args: {
  field?: string;
  days?: number;
}) {
  const days = args.days ?? 90;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: { changedAt: { gte: Date }; field?: string } = {
    changedAt: { gte: since },
  };
  if (args.field) where.field = args.field;

  // summary는 전체 결과로 계산해야 정확. groupBy로 메타 먼저 산출.
  const grouped = await prisma.metricChange.groupBy({
    by: ["field"],
    where,
    _count: { _all: true },
    _min: { changedAt: true },
    _max: { changedAt: true },
  });

  if (grouped.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            _context: "해당 기간 변경 이력 없음.",
            field: args.field ?? "all",
            period: `최근 ${days}일`,
            changes: [],
          }),
        },
      ],
    };
  }

  // 필드별 first(가장 오래된)/latest(가장 최근) row 조회 → 정확한 summary
  const summaryEntries = await Promise.all(
    grouped.map(async (g) => {
      const [first, latest] = await Promise.all([
        prisma.metricChange.findFirst({
          where: { ...where, field: g.field, changedAt: g._min.changedAt ?? since },
          orderBy: { changedAt: "asc" },
        }),
        prisma.metricChange.findFirst({
          where: { ...where, field: g.field, changedAt: g._max.changedAt ?? since },
          orderBy: { changedAt: "desc" },
        }),
      ]);
      return { field: g.field, count: g._count._all, first, latest };
    })
  );

  // 표시용 changes는 최근 100개로 제한
  const changes = await prisma.metricChange.findMany({
    where,
    orderBy: { changedAt: "desc" },
    take: 100,
  });

  const summaries: Record<
    string,
    {
      label: string;
      firstValue: number | null;
      latestValue: number | null;
      changeCount: number;
      netChange: number | null;
    }
  > = {};
  for (const entry of summaryEntries) {
    const firstValue =
      entry.first?.oldValue ?? entry.first?.newValue ?? null;
    const latestValue = entry.latest?.newValue ?? null;
    summaries[entry.field] = {
      label: FIELD_LABELS[entry.field] ?? entry.field,
      firstValue,
      latestValue,
      changeCount: entry.count,
      netChange:
        firstValue !== null && latestValue !== null
          ? Number((latestValue - firstValue).toFixed(2))
          : null,
    };
  }

  const response = {
    _context:
      "메트릭 변경 이력. 양수 netChange는 값 상승(LTHR/VO2max 향상 등), " +
      "음수는 하락. 트래킹 시 source(manual/garmin)와 reason 함께 확인하세요.",
    field: args.field ?? "all",
    period: `최근 ${days}일`,
    summaries,
    changes: changes.map((c) => ({
      date: formatDateLocal(c.changedAt),
      changedAt: c.changedAt.toISOString(),
      field: c.field,
      label: FIELD_LABELS[c.field] ?? c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      delta:
        c.oldValue !== null && c.newValue !== null
          ? Number((c.newValue - c.oldValue).toFixed(2))
          : null,
      source: c.source,
      reason: c.reason,
    })),
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
