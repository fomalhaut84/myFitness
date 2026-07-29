// #269: 활동 저장 후 손목 온도 + 외부 기상 필드 보강.
// - sync/backfill 양쪽에서 재사용.
// - 실패는 상위로 throw 하지 않음 (sync 흐름 보호). 상위가 try-catch 로 wrap.

import prisma from "@/lib/prisma";
import {
  fetchArchiveWeather,
  getActivityStartLocation,
  parseWristTemps,
} from "@/lib/weather/open-meteo";

export interface EnrichOptions {
  activityId: string;
  rawData: unknown;
  startTime: Date;
  duration: number; // seconds
  /** true 면 외부 API 재fetch 건너뜀 (손목 온도만 갱신). */
  alreadyFetched?: boolean;
}

export interface EnrichResult {
  wristUpdated: boolean;
  weatherFetched: boolean;
  weatherSkipped: "no-gps" | "already" | null;
}

export async function enrichActivityWeather(
  opts: EnrichOptions,
): Promise<EnrichResult> {
  const wrist = parseWristTemps(opts.rawData);
  const wristPayload: {
    wristTempMaxC?: number | null;
    wristTempMinC?: number | null;
  } = {};
  if (wrist.max !== null) wristPayload.wristTempMaxC = wrist.max;
  if (wrist.min !== null) wristPayload.wristTempMinC = wrist.min;

  // 손목 온도만 있는 경우도 우선 반영 (원본 값 존재 → 저장).
  if (Object.keys(wristPayload).length > 0) {
    await prisma.activity.update({
      where: { id: opts.activityId },
      data: wristPayload,
    });
  }

  if (opts.alreadyFetched) {
    return {
      wristUpdated: Object.keys(wristPayload).length > 0,
      weatherFetched: false,
      weatherSkipped: "already",
    };
  }

  const loc = getActivityStartLocation(opts.rawData);
  if (!loc) {
    // GPS 없음 (실내). backfill 이 반복 실행돼도 다시 잡히지 않도록 sentinel 을 세팅.
    // weatherFetchedAt 은 시도했다는 사실만 기록, weather* 값은 null 유지.
    await prisma.activity.update({
      where: { id: opts.activityId },
      data: { weatherFetchedAt: new Date(), weatherSource: "no-gps" },
    });
    return {
      wristUpdated: Object.keys(wristPayload).length > 0,
      weatherFetched: false,
      weatherSkipped: "no-gps",
    };
  }

  const sample = await fetchArchiveWeather(
    loc.lat,
    loc.lng,
    opts.startTime,
    opts.duration,
  );
  if (!sample) {
    // API 실패 — weatherFetchedAt null 유지, 다음 backfill 에서 재시도.
    return {
      wristUpdated: Object.keys(wristPayload).length > 0,
      weatherFetched: false,
      weatherSkipped: null,
    };
  }

  await prisma.activity.update({
    where: { id: opts.activityId },
    data: {
      weatherTempC: sample.tempC,
      weatherApparentTempC: sample.apparentTempC,
      weatherHumidityPct: sample.humidityPct,
      weatherWindMs: sample.windMs,
      weatherPrecipMm: sample.precipMm,
      weatherCode: sample.weatherCode,
      weatherFetchedAt: new Date(),
      weatherSource: sample.source,
    },
  });

  return {
    wristUpdated: Object.keys(wristPayload).length > 0,
    weatherFetched: true,
    weatherSkipped: null,
  };
}
