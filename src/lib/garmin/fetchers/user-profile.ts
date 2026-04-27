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

/** RUNNING 또는 DEFAULT만 사용 — 다른 sport(cycling 등)는 러닝 프로필 오염 방지 */
function pickRunningZones(zones: GarminHRZone[]): GarminHRZone | null {
  if (!zones || zones.length === 0) return null;
  return (
    zones.find((z) => z.sport === "RUNNING") ??
    zones.find((z) => z.sport === "DEFAULT") ??
    null
  );
}

/** Garmin lactateThresholdSpeed × 10 = m/s 확정 (사용자 실측 5:21/km 검증 완료) */
function speedToPaceSec(speed: number | null | undefined): number | null {
  if (!speed || speed <= 0) return null;
  return Math.round(100 / speed); // sec/km
}

/**
 * UserProfile 자동값 업데이트 (수동값은 보존) + 변경 시 history 기록.
 * endpoint별 성공 플래그로 부분 실패 시 해당 필드를 건드리지 않음 — null이
 * "Garmin이 명시적으로 비웠다"인지 "endpoint 실패로 데이터 없음"인지 구분.
 */
/**
 * undefined = 페이로드에 필드 자체가 없음 → 변경하지 않음
 * null = Garmin이 명시적으로 비웠음 → stale 클리어
 * value = 새 값
 */
async function applyAutoSync(args: {
  garminMaxHR: number | null | undefined;
  garminLthr: number | null | undefined;
  garminLthrPace: number | null | undefined;
  garminVo2max: number | null | undefined;
  garminRestingHR: number | null | undefined;
  garminLthrAutoDetected: boolean | null | undefined;
  garminLthrMeasuredAt: Date | null | undefined;
  zonesRaw: GarminHRZone | null;
  changeState: string;
  // endpoint 성공 여부
  hrZonesOk: boolean;
  userSettingsOk: boolean;
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
  const historyOps: Array<(tx: Prisma.TransactionClient) => Promise<void>> = [];

  // changeState 기반 reason 결정
  const reason: MetricReason =
    args.changeState && args.changeState !== "UNCHANGED"
      ? "garmin_change_state"
      : args.garminLthrAutoDetected
        ? "garmin_auto_detect"
        : "garmin_initial";

  // 자동 갱신 가능 여부 (source 우선 판정):
  // - source === "garmin" → 갱신 OK
  // - source === null + 값 없음 → 최초 자동 설정 OK
  // - source === "manual" → 보호 (값이 null이어도 — 사용자가 lthrPace만 편집한 경우 등)
  // - source === null + 값 있음 → 마이그레이션 전 데이터 보호 (manual로 간주)
  const canAutoUpdateMaxHR =
    profile.maxHRSource === "garmin" ||
    (profile.maxHRSource === null && profile.maxHR === null);
  const canAutoUpdateLthr =
    profile.lthrSource === "garmin" ||
    (profile.lthrSource === null && profile.lthr === null);
  const canAutoUpdateRestingHR =
    profile.restingHRBaseSource === "garmin" ||
    (profile.restingHRBaseSource === null && profile.restingHRBase === null);

  // 필드별 출처:
  //  - heartRateZones: maxHR, lthr(RUNNING), restingHR, zonesRaw
  //  - user-settings: lthr(fallback), lthrPace, vo2max, lthrAutoDetected, lthrMeasuredAt
  //  실패한 endpoint 데이터는 적용하지 않음 (null이 "Garmin이 비웠다"와
  //  "endpoint 실패로 데이터 없음"을 구분).

  // maxHR — heartRateZones에서만 옴. undefined면 페이로드에 필드 없음 → skip.
  if (
    args.hrZonesOk &&
    canAutoUpdateMaxHR &&
    args.garminMaxHR !== undefined &&
    profile.maxHR !== args.garminMaxHR
  ) {
    const newMaxHR: number | null = args.garminMaxHR;
    historyOps.push((tx) =>
      recordMetricChange(
        {
          field: "maxHR",
          oldValue: profile.maxHR,
          newValue: newMaxHR,
          source: "garmin",
          reason,
        },
        tx
      )
    );
    updates.maxHR = newMaxHR;
  }
  if (
    args.hrZonesOk &&
    canAutoUpdateMaxHR &&
    args.garminMaxHR !== undefined
  ) {
    if (args.garminMaxHR !== null && profile.maxHRSource !== "garmin") {
      updates.maxHRSource = "garmin";
    } else if (args.garminMaxHR === null && profile.maxHRSource === "garmin") {
      updates.maxHRSource = null;
    }
  }

  // LTHR — heartRateZones 우선, user-settings fallback.
  // null 쓰기(stale clear)는 양쪽 endpoint 모두 성공해야 — 한쪽 실패면 null이
  // "Garmin이 비웠다"인지 "endpoint 실패 데이터 없음"인지 구분 불가.
  const lthrAllSourcesOk = args.hrZonesOk && args.userSettingsOk;
  const canWriteLthr =
    args.garminLthr === undefined
      ? false
      : args.garminLthr !== null
        ? args.hrZonesOk || args.userSettingsOk
        : lthrAllSourcesOk;
  if (canWriteLthr && canAutoUpdateLthr && profile.lthr !== args.garminLthr) {
    const newLthr: number | null = args.garminLthr ?? null;
    historyOps.push((tx) =>
      recordMetricChange(
        {
          field: "lthr",
          oldValue: profile.lthr,
          newValue: newLthr,
          source: "garmin",
          reason,
        },
        tx
      )
    );
    updates.lthr = newLthr;
  }
  if (canWriteLthr && canAutoUpdateLthr) {
    if (args.garminLthr !== null && profile.lthrSource !== "garmin") {
      updates.lthrSource = "garmin";
    } else if (args.garminLthr === null && profile.lthrSource === "garmin") {
      // lthr와 lthrPace 둘 다 null로 비워질 때만 source 해제 (lthrPace는 user-settings 성공 시에만 신뢰)
      if (args.userSettingsOk && args.garminLthrPace === null)
        updates.lthrSource = null;
    }
  }

  // lthrAutoDetected, lthrMeasuredAt — user-settings에서만 옴.
  // 필드가 페이로드에 존재할 때만(undefined가 아닐 때) 적용. null도 클리어로 신뢰.
  if (args.userSettingsOk && canAutoUpdateLthr) {
    if (args.garminLthrAutoDetected !== undefined)
      updates.lthrAutoDetected = args.garminLthrAutoDetected;
    if (args.garminLthrMeasuredAt !== undefined)
      updates.lthrMeasuredAt = args.garminLthrMeasuredAt;
  }

  // LTHR Pace — user-settings에서만 옴
  // pace-only 갱신 (lthr는 null이지만 pace는 값) 케이스에서도 lthrSource를
  // garmin으로 표시하기 위해 별도 조건 추가.
  if (
    args.userSettingsOk &&
    canAutoUpdateLthr &&
    args.garminLthrPace !== null &&
    args.garminLthrPace !== undefined &&
    profile.lthrSource !== "garmin"
  ) {
    updates.lthrSource = "garmin";
  }
  if (
    args.userSettingsOk &&
    canAutoUpdateLthr &&
    args.garminLthrPace !== undefined &&
    profile.lthrPace !== args.garminLthrPace
  ) {
    const newPace: number | null = args.garminLthrPace;
    historyOps.push((tx) =>
      recordMetricChange(
        {
          field: "lthrPace",
          oldValue: profile.lthrPace,
          newValue: newPace,
          source: "garmin",
          reason,
        },
        tx
      )
    );
    updates.lthrPace = newPace;
  }

  // VO2max — user-settings에서만 옴
  if (
    args.userSettingsOk &&
    args.garminVo2max !== undefined &&
    profile.vo2maxRunning !== args.garminVo2max
  ) {
    const newVo2: number | null = args.garminVo2max;
    historyOps.push((tx) =>
      recordMetricChange(
        {
          field: "vo2maxRunning",
          oldValue: profile.vo2maxRunning,
          newValue: newVo2,
          source: "garmin",
          reason,
        },
        tx
      )
    );
    updates.vo2maxRunning = newVo2;
  }

  // 안정시 심박 — heartRateZones에서만 옴. 사용자가 수동 설정했으면 보호.
  if (
    args.hrZonesOk &&
    canAutoUpdateRestingHR &&
    args.garminRestingHR !== undefined &&
    profile.restingHRBase !== args.garminRestingHR
  ) {
    const newResting: number | null = args.garminRestingHR;
    historyOps.push((tx) =>
      recordMetricChange(
        {
          field: "restingHRBase",
          oldValue: profile.restingHRBase,
          newValue: newResting,
          source: "garmin",
          reason,
        },
        tx
      )
    );
    updates.restingHRBase = newResting;
  }
  if (
    args.hrZonesOk &&
    canAutoUpdateRestingHR &&
    args.garminRestingHR !== undefined
  ) {
    if (
      args.garminRestingHR !== null &&
      profile.restingHRBaseSource !== "garmin"
    ) {
      updates.restingHRBaseSource = "garmin";
    } else if (
      args.garminRestingHR === null &&
      profile.restingHRBaseSource === "garmin"
    ) {
      updates.restingHRBaseSource = null;
    }
  }

  // Zone raw 데이터 보존 — heartRateZones에서만 옴
  if (args.hrZonesOk && args.zonesRaw) {
    updates.heartRateZonesRaw = args.zonesRaw as unknown as Prisma.InputJsonValue;
  }

  // UserProfile update + MetricChange 기록을 원자적으로 처리.
  // history 기록 실패 시 profile 변경도 롤백되어 다음 싱크에서 다시 delta 감지 가능.
  await prisma.$transaction(async (tx) => {
    await tx.userProfile.update({
      where: { id: profile.id },
      data: updates,
    });
    for (const op of historyOps) {
      await op(tx);
    }
  });
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

  const runningZones = pickRunningZones(zones);
  const userData = settings?.userData ?? {};
  // 빈/누락 페이로드도 "데이터 없음"으로 처리하여 stale clear 방지.
  // user-settings는 settings.userData 존재 + 핵심 필드 중 하나 이상 있을 때만 OK.
  const ud = settings?.userData;
  const hasUserData = Boolean(
    ud &&
      (ud.lactateThresholdHeartRate !== undefined ||
        ud.lactateThresholdSpeed !== undefined ||
        ud.vo2MaxRunning !== undefined ||
        ud.thresholdHeartRateAutoDetected !== undefined ||
        ud.firstbeatRunningLtTimestamp !== undefined)
  );
  const hrZonesOk =
    !errors.some((e) => e.source === "heartRateZones") &&
    runningZones !== null;
  const userSettingsOk =
    !errors.some((e) => e.source === "user-settings") && hasUserData;

  // 양쪽 모두 사용 가능한 데이터가 없으면 throw — 200 OK + 빈 페이로드 케이스도 잡음.
  // (HTTP 에러로 인한 errors.length === 2 케이스도 자동 포함)
  if (!hrZonesOk && !userSettingsOk) {
    const reasons = [
      ...errors.map((e) => `${e.source}=${e.message}`),
      runningZones === null && !errors.some((e) => e.source === "heartRateZones")
        ? "heartRateZones=빈 페이로드"
        : null,
      !hasUserData && !errors.some((e) => e.source === "user-settings")
        ? "user-settings=빈 userData"
        : null,
    ].filter(Boolean);
    throw new Error(
      `Garmin user-profile 사용 가능한 데이터 없음: ${reasons.join(" / ")}`
    );
  }

  // undefined = 페이로드에 필드 없음, null = 명시적 비움. 둘을 구분하여 전달.
  // hrZones LTHR 우선, 없으면 user-settings LTHR; 둘 다 undefined면 undefined 유지.
  const lthrFromZones = runningZones
    ? runningZones.lactateThresholdHeartRateUsed
    : undefined;
  const lthrFromSettings = userData.lactateThresholdHeartRate;
  const garminLthr =
    lthrFromZones !== undefined && lthrFromZones !== null
      ? lthrFromZones
      : lthrFromSettings !== undefined && lthrFromSettings !== null
        ? lthrFromSettings
        : lthrFromZones !== undefined
          ? lthrFromZones
          : lthrFromSettings;

  const lthrPaceSpeed = userData.lactateThresholdSpeed;
  const garminLthrPace =
    lthrPaceSpeed === undefined ? undefined : speedToPaceSec(lthrPaceSpeed);

  const lthrTs = userData.firstbeatRunningLtTimestamp;
  const garminLthrMeasuredAt =
    lthrTs === undefined
      ? undefined
      : lthrTs === null
        ? null
        : new Date(lthrTs * 1000);

  await applyAutoSync({
    hrZonesOk,
    userSettingsOk,
    garminMaxHR: runningZones ? runningZones.maxHeartRateUsed : undefined,
    garminLthr,
    garminLthrPace,
    garminVo2max: userData.vo2MaxRunning,
    garminRestingHR: runningZones ? runningZones.restingHeartRateUsed : undefined,
    garminLthrAutoDetected: userData.thresholdHeartRateAutoDetected,
    garminLthrMeasuredAt,
    zonesRaw: runningZones,
    changeState: runningZones?.changeState ?? "UNCHANGED",
  });

  // 부분 실패도 sync metadata에 노출되도록 throw.
  // 데이터는 이미 apply됨 → 다음 retry에서 metadata가 정상 업데이트되며 자연 복구.
  if (errors.length > 0) {
    throw new Error(
      `Garmin user-profile 부분 실패 (data 일부 적용됨): ${errors.map((e) => `${e.source}=${e.message}`).join(" / ")}`
    );
  }

  return 1;
}

// 외부에서 사용 (테스트용)
export const _internal = { pickRunningZones, speedToPaceSec, applyAutoSync };

// MetricField 재내보내기 (호출부 편의)
export type { MetricField };
