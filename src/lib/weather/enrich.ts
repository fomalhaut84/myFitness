// #269: 활동 저장 후 손목 온도 + 외부 기상 필드 보강.
// - parseAndSaveWristTemps: 네트워크 X, sync 안전. 손목 온도만.
// - enrichActivityWeather: 외부 API 호출 포함. backfill 스크립트 전용.
// - Codex P1 (#269 후속): sync 경로에서 외부 API 를 호출하면 timeout × N 활동 만큼 sync 가
//   정지 → 100 활동 = 최대 13분. sync 는 wrist 만, weather 는 backfill 에서 처리.

import prisma from "@/lib/prisma";
import {
  fetchArchiveWeather,
  getActivityStartLocation,
  getActivityStartUtc,
  parseWristTemps,
} from "@/lib/weather/open-meteo";

// #269 후속: transient 실패 (timeout, 429, all-null 등) 를 이 횟수 초과로 축적하면 sentinel
// 저장 후 재시도 중단. 매 tick 30 건 batch 를 오래된 실패가 무한 점유하는 스타베이션 방지.
const MAX_WEATHER_ATTEMPTS = 5;

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

  const result = await fetchArchiveWeather(
    loc.lat,
    loc.lng,
    opts.startTime,
    opts.duration,
  );

  if (result.kind === "transient") {
    // 재시도 가능 — attempt 카운터 증가. MAX 초과 시 sentinel 로 강등 (스타베이션 방지).
    // 현재 attempts 를 read → +1. 5회 이상이면 fetchedAt 세팅해 backfill 제외.
    const current = await prisma.activity.findUnique({
      where: { id: opts.activityId },
      select: { weatherAttempts: true },
    });
    const nextAttempts = (current?.weatherAttempts ?? 0) + 1;
    const exceeded = nextAttempts >= MAX_WEATHER_ATTEMPTS;
    await prisma.activity.update({
      where: { id: opts.activityId },
      data: exceeded
        ? {
            weatherAttempts: nextAttempts,
            weatherFetchedAt: new Date(),
            weatherSource: `failed:transient-max:${result.reason}`,
          }
        : { weatherAttempts: nextAttempts },
    });
    return {
      wristUpdated: wristResult.wristUpdated,
      weatherFetched: false,
      weatherSkipped: null,
    };
  }

  if (result.kind === "terminal") {
    // Codex P1 (#269 후속): 재시도 무의미한 실패 (4xx, invalid coord, out-of-range date 등)
    // 는 sentinel 로 저장. cron 이 매 tick 같은 permanent 실패에 걸려 스타베이션 되는 것 방지.
    await prisma.activity.update({
      where: { id: opts.activityId },
      data: {
        weatherFetchedAt: new Date(),
        weatherSource: `failed:${result.reason}`,
      },
    });
    return {
      wristUpdated: wristResult.wristUpdated,
      weatherFetched: false,
      weatherSkipped: null,
    };
  }

  const sample = result.sample;
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
      weatherAttempts: null,
    },
  });

  return {
    wristUpdated: wristResult.wristUpdated,
    weatherFetched: true,
    weatherSkipped: null,
  };
}

export interface RunBackfillOptions {
  limit?: number;
  skip?: number;
  sleepMs?: number;
  /** 진행 로그 출력 여부. cron 은 조용히 (false), script 는 true. */
  verbose?: boolean;
  /** dryRun 이면 대상 카운트만 반환, DB update 없음. */
  dryRun?: boolean;
}

export interface RunBackfillResult {
  candidates: number;
  ok: number;
  skipped: number;
  failed: number;
}

/**
 * weather backfill 공용 러너. scripts/backfill-weather.ts + cron.ts 에서 재사용.
 * Codex P1 (#269): sync 루프에서 외부 API 를 뺐으므로 자동 enrichment 경로가 없어졌음.
 * cron 은 sync 후 이 함수를 소규모 limit 으로 호출해 신규 활동을 백그라운드에서 채움.
 */
export async function runWeatherBackfill(
  opts: RunBackfillOptions = {},
): Promise<RunBackfillResult> {
  const skip = opts.skip ?? 0;
  const limit = opts.limit;
  const sleepMs = opts.sleepMs ?? 200;
  const verbose = opts.verbose ?? false;

  const rows = await prisma.activity.findMany({
    where: { weatherFetchedAt: null },
    // #269 후속 (Codex P2): attempts 오름차순 (nulls first) — 미시도 활동이 우선.
    // 이후 startTime asc — 오래된 것부터. 같은 attempts 안에서 오래된 실패가 앞이지만
    // 신규 활동 (attempts null) 이 항상 앞이라 스타베이션 없음.
    orderBy: [{ weatherAttempts: { sort: "asc", nulls: "first" } }, { startTime: "asc" }],
    select: {
      id: true,
      name: true,
      startTime: true,
      duration: true,
      rawData: true,
      activityType: true,
    },
    ...(skip > 0 ? { skip } : {}),
    ...(limit !== undefined ? { take: limit } : {}),
  });

  const result: RunBackfillResult = {
    candidates: rows.length,
    ok: 0,
    skipped: 0,
    failed: 0,
  };

  if (opts.dryRun) return result;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const res = await enrichActivityWeather({
        activityId: r.id,
        rawData: r.rawData,
        // DB.startTime 은 KST 하드코딩되어 국외 활동 UTC 어긋남. rawData.startTimeGMT 우선.
        startTime: getActivityStartUtc(r.rawData, r.startTime),
        duration: r.duration,
      });
      if (res.weatherFetched) result.ok++;
      else if (res.weatherSkipped) result.skipped++;
      else result.failed++;
    } catch (err) {
      result.failed++;
      if (verbose) {
        console.warn(
          `  ! ${r.startTime.toISOString()} activity ${r.id} 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (verbose && ((i + 1) % 20 === 0 || i === rows.length - 1)) {
      console.log(
        `  진행 ${i + 1}/${rows.length} — 성공 ${result.ok}, 스킵 ${result.skipped}, 실패 ${result.failed}`,
      );
    }
    if (sleepMs > 0 && i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }

  return result;
}
