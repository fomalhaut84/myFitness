import prisma from "../prisma";
import {
  garminZoneRanges,
  getZoneRanges,
  resolveLTHR,
  resolveMaxHR,
  type GarminZonesRaw,
} from "@/lib/fitness/zones";

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

  // Zone (Garmin Floor 우선)
  const garminZones = profile.heartRateZonesRaw
    ? garminZoneRanges(profile.heartRateZonesRaw as unknown as GarminZonesRaw)
    : null;
  const zones = garminZones ?? getZoneRanges(resolveLTHR(profile), maxHRValue);
  const zoneSource: "garmin" | "calculated" = garminZones ? "garmin" : "calculated";

  const response = {
    _context:
      "사용자 프로필 + Garmin 자동 동기화된 maxHR/LTHR/Zone. " +
      "각 값에 source가 표시됨 (manual=사용자 수동, garmin=자동, activity=DB 추정, estimated=공식).",
    name: profile.name,
    birthDate: profile.birthDate?.toISOString().slice(0, 10) ?? null,
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
        }
      : null,
    vo2maxRunning: profile.vo2maxRunning,
    restingHR: profile.restingHRBase,
    targetWeight: profile.targetWeight,
    targetCalories: profile.targetCalories,
    targetDate: profile.targetDate?.toISOString().slice(0, 10) ?? null,
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

  const changes = await prisma.metricChange.findMany({
    where,
    orderBy: { changedAt: "desc" },
    take: 100,
  });

  if (changes.length === 0) {
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

  // 필드별 그룹화하여 summary 계산
  const byField = new Map<string, typeof changes>();
  for (const c of changes) {
    const list = byField.get(c.field) ?? [];
    list.push(c);
    byField.set(c.field, list);
  }
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
  for (const [field, list] of byField.entries()) {
    // list는 changedAt desc → 첫 항목이 latest, 마지막이 first
    const latest = list[0];
    const earliest = list[list.length - 1];
    const firstValue = earliest.oldValue ?? earliest.newValue;
    const latestValue = latest.newValue;
    summaries[field] = {
      label: FIELD_LABELS[field] ?? field,
      firstValue,
      latestValue,
      changeCount: list.length,
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
      date: c.changedAt.toISOString().slice(0, 10),
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
