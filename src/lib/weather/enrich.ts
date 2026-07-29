// #269: 활동 저장 후 손목 온도 + 외부 기상 필드 보강.
// - parseAndSaveWristTemps: 네트워크 X, sync 안전. 손목 온도만.
// - enrichActivityWeather: 외부 API 호출 포함. backfill 스크립트 전용.
// - Codex P1 (#269 후속): sync 경로에서 외부 API 를 호출하면 timeout × N 활동 만큼 sync 가
//   정지 → 100 활동 = 최대 13분. sync 는 wrist 만, weather 는 backfill 에서 처리.

import prisma from "@/lib/prisma";
import {
  fetchArchiveWeather,
  getActivityStartLocation,
  parseWristTemps,
} from "@/lib/weather/open-meteo";

export interface WristSaveResult {
  wristUpdated: boolean;
}

/**
 * sync 안전 (I/O = DB update 1건, 네트워크 없음). Garmin rawData 에서 손목 온도만 파싱해 저장.
 * 저장할 값이 없으면 no-op. weather 는 별도 backfill 스크립트가 처리.
 */
export async function parseAndSaveWristTemps(
  activityId: string,
  rawData: unknown,
): Promise<WristSaveResult> {
  const wrist = parseWristTemps(rawData);
  const wristPayload: {
    wristTempMaxC?: number | null;
    wristTempMinC?: number | null;
  } = {};
  if (wrist.max !== null) wristPayload.wristTempMaxC = wrist.max;
  if (wrist.min !== null) wristPayload.wristTempMinC = wrist.min;
  if (Object.keys(wristPayload).length === 0) return { wristUpdated: false };
  await prisma.activity.update({
    where: { id: activityId },
    data: wristPayload,
  });
  return { wristUpdated: true };
}

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

/**
 * 손목 + 외부 기상 통합 보강. 외부 API 호출 포함 → **sync 경로에서 호출 금지** (Codex P1).
 * backfill 스크립트 전용.
 */
export async function enrichActivityWeather(
  opts: EnrichOptions,
): Promise<EnrichResult> {
  const wristResult = await parseAndSaveWristTemps(opts.activityId, opts.rawData);

  if (opts.alreadyFetched) {
    return {
      wristUpdated: wristResult.wristUpdated,
      weatherFetched: false,
      weatherSkipped: "already",
    };
  }

  const loc = getActivityStartLocation(opts.rawData);
  if (!loc) {
    // GPS 없음 (실내). backfill 이 반복 실행돼도 다시 잡히지 않도록 sentinel 을 세팅.
    await prisma.activity.update({
      where: { id: opts.activityId },
      data: { weatherFetchedAt: new Date(), weatherSource: "no-gps" },
    });
    return {
      wristUpdated: wristResult.wristUpdated,
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
      wristUpdated: wristResult.wristUpdated,
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
    wristUpdated: wristResult.wristUpdated,
    weatherFetched: true,
    weatherSkipped: null,
  };
}
