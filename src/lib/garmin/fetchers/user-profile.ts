import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import {
  recordMetricChange,
  type MetricField,
  type MetricReason,
} from "@/lib/fitness/profile-history";
import { withRateLimit } from "../utils";

const HR_ZONES_URL = "https://connectapi.garmin.com/biometric-service/heartRateZones";
const USER_SETTINGS_URL =
  "https://connectapi.garmin.com/userprofile-service/userprofile/user-settings";

interface GarminHRZone {
  trainingMethod: string;
  restingHeartRateUsed: number | null;
  lactateThresholdHeartRateUsed: number | null;
  zone1Floor: number | null;
  zone2Floor: number | null;
  zone3Floor: number | null;
  zone4Floor: number | null;
  zone5Floor: number | null;
  maxHeartRateUsed: number | null;
  restingHrAutoUpdateUsed: boolean | null;
  sport: string;
  changeState: string;
}

interface GarminUserSettings {
  userData?: {
    lactateThresholdSpeed?: number | null;
    lactateThresholdHeartRate?: number | null;
    vo2MaxRunning?: number | null;
    thresholdHeartRateAutoDetected?: boolean | null;
    firstbeatRunningLtTimestamp?: number | null;
  };
}

/** 러닝 우선, 없으면 DEFAULT, 없으면 첫 row */
function pickRunningZones(zones: GarminHRZone[]): GarminHRZone | null {
  if (!zones || zones.length === 0) return null;
  return (
    zones.find((z) => z.sport === "RUNNING") ??
    zones.find((z) => z.sport === "DEFAULT") ??
    zones[0]
  );
}

/** Garmin lactateThresholdSpeed × 10 = m/s 확정 (사용자 실측 5:21/km 검증 완료) */
function speedToPaceSec(speed: number | null | undefined): number | null {
  if (!speed || speed <= 0) return null;
  return Math.round(100 / speed); // sec/km
}

/** UserProfile 자동값 업데이트 (수동값은 보존) + 변경 시 history 기록 */
async function applyAutoSync(args: {
  garminMaxHR: number | null;
  garminLthr: number | null;
  garminLthrPace: number | null;
  garminVo2max: number | null;
  garminRestingHR: number | null;
  garminLthrAutoDetected: boolean | null;
  garminLthrMeasuredAt: Date | null;
  zonesRaw: GarminHRZone | null;
  changeState: string;
}): Promise<void> {
  // 신규 사용자도 첫 싱크에서 자동 설정되도록 singleton upsert.
  const profile = await prisma.userProfile.upsert({
    where: { singleton: true },
    update: {},
    create: { singleton: true, name: "사용자" },
  });

  const updates: Prisma.UserProfileUpdateInput = {
    garminSyncedAt: new Date(),
  };
  const historyOps: Array<() => Promise<void>> = [];

  // changeState 기반 reason 결정
  const reason: MetricReason =
    args.changeState && args.changeState !== "UNCHANGED"
      ? "garmin_change_state"
      : args.garminLthrAutoDetected
        ? "garmin_auto_detect"
        : "garmin_initial";

  // 자동 갱신 가능 여부:
  // - source === "garmin" → 갱신 OK
  // - source === null + 값 없음 → 최초 자동 설정 OK
  // - source === null + 값 있음 → manual로 간주 (마이그레이션 전 데이터 보호)
  // - source === "manual" → 보호
  const canAutoUpdateMaxHR =
    profile.maxHR === null ||
    profile.maxHRSource === "garmin" ||
    (profile.maxHRSource === null && profile.maxHR === null);
  const canAutoUpdateLthr =
    profile.lthr === null ||
    profile.lthrSource === "garmin" ||
    (profile.lthrSource === null && profile.lthr === null);

  // maxHR
  if (args.garminMaxHR && canAutoUpdateMaxHR) {
    if (profile.maxHR !== args.garminMaxHR) {
      historyOps.push(() =>
        recordMetricChange({
          field: "maxHR",
          oldValue: profile.maxHR,
          newValue: args.garminMaxHR,
          source: "garmin",
          reason,
        })
      );
      updates.maxHR = args.garminMaxHR;
    }
    if (profile.maxHRSource !== "garmin") updates.maxHRSource = "garmin";
  }

  // LTHR
  if (args.garminLthr && canAutoUpdateLthr) {
    if (profile.lthr !== args.garminLthr) {
      historyOps.push(() =>
        recordMetricChange({
          field: "lthr",
          oldValue: profile.lthr,
          newValue: args.garminLthr,
          source: "garmin",
          reason,
        })
      );
      updates.lthr = args.garminLthr;
    }
    if (profile.lthrSource !== "garmin") updates.lthrSource = "garmin";
    if (args.garminLthrAutoDetected !== null)
      updates.lthrAutoDetected = args.garminLthrAutoDetected;
    if (args.garminLthrMeasuredAt) updates.lthrMeasuredAt = args.garminLthrMeasuredAt;
  }

  // LTHR Pace
  if (args.garminLthrPace) {
    if (profile.lthrPace !== args.garminLthrPace) {
      historyOps.push(() =>
        recordMetricChange({
          field: "lthrPace",
          oldValue: profile.lthrPace,
          newValue: args.garminLthrPace,
          source: "garmin",
          reason,
        })
      );
      updates.lthrPace = args.garminLthrPace;
    }
  }

  // VO2max
  if (args.garminVo2max && profile.vo2maxRunning !== args.garminVo2max) {
    historyOps.push(() =>
      recordMetricChange({
        field: "vo2maxRunning",
        oldValue: profile.vo2maxRunning,
        newValue: args.garminVo2max,
        source: "garmin",
        reason,
      })
    );
    updates.vo2maxRunning = args.garminVo2max;
  }

  // 안정시 심박 (수동 설정 없을 때만)
  if (args.garminRestingHR && profile.restingHRBase === null) {
    historyOps.push(() =>
      recordMetricChange({
        field: "restingHRBase",
        oldValue: profile.restingHRBase,
        newValue: args.garminRestingHR,
        source: "garmin",
        reason,
      })
    );
    updates.restingHRBase = args.garminRestingHR;
  }

  // Zone raw 데이터 보존
  if (args.zonesRaw) {
    updates.heartRateZonesRaw = args.zonesRaw as unknown as Prisma.InputJsonValue;
  }

  await prisma.userProfile.update({
    where: { id: profile.id },
    data: updates,
  });

  // 모든 history 기록
  for (const op of historyOps) {
    await op();
  }
}

/**
 * Garmin 프로필 동기화. 두 API 호출:
 *   1. /biometric-service/heartRateZones (러닝 sport) - maxHR/LTHR/Zone
 *   2. /userprofile-service/userprofile/user-settings - VO2max/lthrPace/메타
 */
export async function syncUserProfile(
  client: GarminConnect,
  _startDate: Date,
  _endDate: Date
): Promise<number> {
  let zones: GarminHRZone[] = [];
  let settings: GarminUserSettings | null = null;
  const errors: { source: string; message: string }[] = [];

  try {
    zones = await withRateLimit(() => client.get<GarminHRZone[]>(HR_ZONES_URL));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[user-profile] heartRateZones 조회 실패:", msg);
    errors.push({ source: "heartRateZones", message: msg });
  }

  try {
    settings = await withRateLimit(() =>
      client.get<GarminUserSettings>(USER_SETTINGS_URL)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[user-profile] user-settings 조회 실패:", msg);
    errors.push({ source: "user-settings", message: msg });
  }

  // 두 API 모두 실패 시 fetch 에러로 전파 (sync metadata에 error 기록되도록)
  if (errors.length === 2) {
    throw new Error(
      `Garmin user-profile 조회 모두 실패: ${errors.map((e) => `${e.source}=${e.message}`).join(" / ")}`
    );
  }

  if (!zones.length && !settings) return 0;

  const runningZones = pickRunningZones(zones);
  const userData = settings?.userData ?? {};

  await applyAutoSync({
    garminMaxHR: runningZones?.maxHeartRateUsed ?? null,
    garminLthr:
      runningZones?.lactateThresholdHeartRateUsed ??
      userData.lactateThresholdHeartRate ??
      null,
    garminLthrPace: speedToPaceSec(userData.lactateThresholdSpeed ?? null),
    garminVo2max: userData.vo2MaxRunning ?? null,
    garminRestingHR: runningZones?.restingHeartRateUsed ?? null,
    garminLthrAutoDetected: userData.thresholdHeartRateAutoDetected ?? null,
    garminLthrMeasuredAt: userData.firstbeatRunningLtTimestamp
      ? new Date(userData.firstbeatRunningLtTimestamp * 1000)
      : null,
    zonesRaw: runningZones,
    changeState: runningZones?.changeState ?? "UNCHANGED",
  });

  return 1;
}

// 외부에서 사용 (테스트용)
export const _internal = { pickRunningZones, speedToPaceSec, applyAutoSync };

// MetricField 재내보내기 (호출부 편의)
export type { MetricField };
