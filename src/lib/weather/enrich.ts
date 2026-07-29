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

// Codex P2 (#269): fire-and-forget backfill 이 다중 프로세스/시퀀셜 syncAll 에 의해 동시 실행되면
// 동일 row 를 각자 read → 중복 API 호출 + attempts/sentinel 갱신 race (성공 update 를 실패 sentinel
// 이 덮어쓸 수 있음). 프로젝트 기존 패턴 (SystemAlertState atomic reserve) 로 전 프로세스 단일
// 실행 보장. TTL 로 크래시 프로세스가 lock 을 영구 점유하지 않도록 self-heal.
const BACKFILL_LOCK_ALERT_TYPE = "weather_backfill_lock";
const BACKFILL_LOCK_TTL_MS = 10 * 60 * 1000; // 10분 — 30건 배치 여유
// Codex P1 (#269): 무제한 script run 대비 처리 중 주기적 lease 갱신 (heartbeat). 갱신 실패
// (누군가 stale 로 재획득) 시 즉시 중단해 race 방지. TTL 절반 주기가 적당.
const BACKFILL_RENEWAL_EVERY_N_ROWS = 5;

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

  // Lock 획득 (cross-process). dry-run 은 read-only 라 lock 불필요.
  const empty: RunBackfillResult = { candidates: 0, ok: 0, skipped: 0, failed: 0 };
  const claim = opts.dryRun ? new Date() : await tryAcquireBackfillLock();
  if (!claim) {
    if (verbose) {
      console.log("[weather-backfill] 다른 실행자가 lock 보유 중 — 건너뜀");
    }
    return empty;
  }

  const heartbeat: LockHeartbeat = { claim };
  try {
    return await runWeatherBackfillLocked(opts, skip, limit, sleepMs, verbose, heartbeat);
  } finally {
    if (!opts.dryRun) {
      await releaseBackfillLock(heartbeat.claim);
    }
  }
}

/** heartbeat 로 갱신되는 최신 claim 시각을 저장하는 mutable holder. */
interface LockHeartbeat {
  claim: Date;
}

/**
 * SystemAlertState 원자적 예약 패턴 (project standard). 성공 시 우리가 세팅한 lastAlertAt 반환.
 * TTL 초과된 stale lock 은 다른 프로세스가 이어받을 수 있음 (self-heal). 첫 실행 (row 없음) 은
 * INSERT + unique 위반 방어 (동시 첫 실행) — 실패 시 재조회.
 */
async function tryAcquireBackfillLock(): Promise<Date | null> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - BACKFILL_LOCK_TTL_MS);
  // 1) 기존 row 갱신 시도 (TTL 만료된 lock 만 재획득).
  const updated = await prisma.systemAlertState.updateMany({
    where: { alertType: BACKFILL_LOCK_ALERT_TYPE, lastAlertAt: { lt: cutoff } },
    data: { lastAlertAt: now },
  });
  if (updated.count === 1) return now;
  // 2) row 없으면 INSERT 시도. 동시 INSERT 는 unique 위반 → null 반환 (누군가 이미 가짐).
  try {
    await prisma.systemAlertState.create({
      data: { alertType: BACKFILL_LOCK_ALERT_TYPE, lastAlertAt: now },
    });
    return now;
  } catch {
    return null;
  }
}

/** 우리가 세팅한 lastAlertAt 이 그대로 유지되고 있을 때만 (다른 프로세스가 재획득 안 했을 때) 해제. */
async function releaseBackfillLock(claim: Date): Promise<void> {
  try {
    await prisma.systemAlertState.updateMany({
      where: { alertType: BACKFILL_LOCK_ALERT_TYPE, lastAlertAt: claim },
      data: { lastAlertAt: new Date(0) },
    });
  } catch (err) {
    console.warn(
      `[weather-backfill] lock 해제 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 처리 중 lease 갱신. previous claim 이 그대로일 때만 갱신 성공 (다른 프로세스가 stale 로
 * 재획득했으면 count=0 → null 반환 → 호출자는 중단해야 race 방지).
 */
async function renewBackfillLock(previous: Date): Promise<Date | null> {
  const now = new Date();
  const updated = await prisma.systemAlertState.updateMany({
    where: { alertType: BACKFILL_LOCK_ALERT_TYPE, lastAlertAt: previous },
    data: { lastAlertAt: now },
  });
  return updated.count === 1 ? now : null;
}

async function runWeatherBackfillLocked(
  opts: RunBackfillOptions,
  skip: number,
  limit: number | undefined,
  sleepMs: number,
  verbose: boolean,
  heartbeat: LockHeartbeat,
): Promise<RunBackfillResult> {
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
    // Codex P1 (#269): 처리 중 lease 갱신. 갱신 실패면 stale 취급 재획득 발생 → 즉시 중단.
    if (i > 0 && i % BACKFILL_RENEWAL_EVERY_N_ROWS === 0) {
      const renewed = await renewBackfillLock(heartbeat.claim);
      if (!renewed) {
        if (verbose) {
          console.log(
            `[weather-backfill] lock lease 소실 (i=${i}) — 중단 (다른 프로세스 재획득)`,
          );
        }
        break;
      }
      heartbeat.claim = renewed;
    }
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
