// #269: Open-Meteo 기상 어댑터. 활동 시작 시점의 실제 기상 (온도/체감/습도/풍속/강수/날씨코드) 조회.
// - 인증 불필요, 무료.
// - Archive endpoint 는 관측 데이터 저장에 ~5일 지연 존재. 그 이내 활동은 Forecast endpoint
//   (past_days=... 지원, 92일 이내 과거 커버) 로 fallback. Codex P1 (#269) 대응.
// - 에러는 상위에서 관용 처리 — sync 는 실패해도 계속 진행 (activity 자체는 저장).

const ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
// Archive publish 지연 안전 마진 (실측 ~5일).
const ARCHIVE_MIN_AGE_MS = 7 * 24 * 3600 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;

/** 활동 시작 시각이 Archive 커버 가능한지 (관측 지연 반영). 오래됐으면 archive, 최근이면 forecast. */
function pickEndpoint(startTimeUtc: Date, nowMs: number): string {
  return nowMs - startTimeUtc.getTime() >= ARCHIVE_MIN_AGE_MS
    ? ARCHIVE_ENDPOINT
    : FORECAST_ENDPOINT;
}

export interface WeatherSample {
  tempC: number | null;
  apparentTempC: number | null;
  humidityPct: number | null;
  windMs: number | null;
  precipMm: number | null;        // 활동 duration 커버 시간대 누적 (mm)
  weatherCode: number | null;
  source: "open-meteo";
}

interface ArchiveHourly {
  time?: string[];
  temperature_2m?: (number | null)[];
  apparent_temperature?: (number | null)[];
  relative_humidity_2m?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  precipitation?: (number | null)[];
  weather_code?: (number | null)[];
}

interface ArchiveResponse {
  hourly?: ArchiveHourly;
  error?: boolean;
  reason?: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** hour precision (분/초 버림) 을 UTC 기준 ISO 시각 문자열로. Open-Meteo hourly.time 항목과 매칭 위해. */
function hourKeyUtc(d: Date): string {
  const iso = d.toISOString();
  // "2026-07-29T09:37:12.000Z" → "2026-07-29T09:00"
  return iso.slice(0, 13) + ":00";
}

function pickAt(values: (number | null)[] | undefined, index: number): number | null {
  if (!values) return null;
  const v = values[index];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Codex P2: 활동이 걸친 각 시간 버킷을 실제 겹치는 초 비율로 가중해 강수량 합계.
 * Open-Meteo hourly.precipitation[t] 는 **preceding hour 합계** — 즉 timestamp t 는
 * `[t-1h, t)` 구간의 강수량. Codex 추가 P2 (#269): 이전 코드는 t 를 `[t, t+1h)` 로
 * 취급해 강수를 1시간씩 앞당겨 기록. 예: 09:15-09:45 활동 → 09:00 버킷 (08:00-09:00) 이
 * 아니라 10:00 버킷 (09:00-10:00) 이 실 노출 강수.
 */
function precipProrated(
  hourly: ArchiveHourly,
  start: Date,
  end: Date,
): number | null {
  const precip = hourly.precipitation;
  const times = hourly.time;
  if (!precip || !times || times.length === 0) return null;
  const startMs = start.getTime();
  const endMs = end.getTime();
  let total = 0;
  let any = false;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t) continue;
    // Open-Meteo hourly.time 은 "YYYY-MM-DDTHH:MM" (초·zone 없음). UTC 로 명시.
    // precipitation[i] 는 [hourEnd - 1h, hourEnd) 구간의 합.
    const hourEnd = Date.parse(t + ":00Z");
    if (!Number.isFinite(hourEnd)) continue;
    const hourStart = hourEnd - 3600 * 1000;
    if (hourEnd <= startMs || hourStart >= endMs) continue;
    const overlapStart = Math.max(startMs, hourStart);
    const overlapEnd = Math.min(endMs, hourEnd);
    const weight = (overlapEnd - overlapStart) / (3600 * 1000);
    const v = precip[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v * weight;
      any = true;
    }
  }
  return any ? total : null;
}

export interface FetchArchiveOptions {
  timeoutMs?: number;
  /** injection point for testing */
  fetchImpl?: typeof fetch;
  /** now(). 테스트에서 시각 고정용. */
  now?: number;
}

/**
 * 특정 GPS + 활동 시간대의 기상 요약을 반환. 실패 시 null (에러 throw 안 함 — 상위 sync 안전).
 * duration 은 초 단위. Archive publish 지연 ~5일 이내 활동은 Forecast endpoint 로 fallback.
 */
export async function fetchArchiveWeather(
  lat: number,
  lng: number,
  startTimeUtc: Date,
  durationSec: number,
  opts: FetchArchiveOptions = {},
): Promise<WeatherSample | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const end = new Date(startTimeUtc.getTime() + durationSec * 1000);
  const startDate = toIsoDate(startTimeUtc);
  const endDate = toIsoDate(end);
  const startHourKey = hourKeyUtc(startTimeUtc);
  const nowMs = opts.now ?? Date.now();
  const endpoint = pickEndpoint(startTimeUtc, nowMs);

  const url = new URL(endpoint);
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lng.toString());
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "wind_speed_10m",
      "precipitation",
      "weather_code",
    ].join(","),
  );
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("wind_speed_unit", "ms");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = opts.fetchImpl ?? fetch;

  // Codex P2: fetch 응답 헤더 수신 후 body 스트리밍이 stall 하면 이전 코드는 timeout 을
  // 이미 clear 해 무한 대기. body 파싱까지 같은 try/finally 로 감싸 abort signal 유효.
  let response: Response;
  let body: ArchiveResponse;
  try {
    response = await doFetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      console.warn(`[weather] HTTP ${response.status} — ${await response.text().catch(() => "")}`);
      return null;
    }
    body = (await response.json()) as ArchiveResponse;
  } catch (err) {
    console.warn(`[weather] fetch 실패 (network/timeout/parse): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (body.error) {
    console.warn(`[weather] API error: ${body.reason ?? "unknown"}`);
    return null;
  }

  const hourly = body.hourly;
  const times = hourly?.time ?? [];
  if (!hourly || times.length === 0) return null;

  const startIndex = times.indexOf(startHourKey);
  if (startIndex < 0) {
    console.warn(`[weather] start hour ${startHourKey} 응답 시간축 미포함`);
    return null;
  }

  const humidityRaw = pickAt(hourly.relative_humidity_2m, startIndex);
  const weatherCodeRaw = pickAt(hourly.weather_code, startIndex);
  const sample: WeatherSample = {
    tempC: pickAt(hourly.temperature_2m, startIndex),
    apparentTempC: pickAt(hourly.apparent_temperature, startIndex),
    humidityPct: humidityRaw !== null ? Math.round(humidityRaw) : null,
    windMs: pickAt(hourly.wind_speed_10m, startIndex),
    precipMm: precipProrated(hourly, startTimeUtc, end),
    weatherCode: weatherCodeRaw !== null ? Math.round(weatherCodeRaw) : null,
    source: "open-meteo",
  };

  // Codex P2: 응답은 유효하지만 모든 측정치가 null 인 경우 (배열 자체 누락 등) → fetch 실패로
  // 취급. 이대로 저장하면 weatherFetchedAt 이 세팅되어 backfill 이 영영 재시도하지 않음.
  const hasAny =
    sample.tempC !== null ||
    sample.apparentTempC !== null ||
    sample.humidityPct !== null ||
    sample.windMs !== null ||
    sample.precipMm !== null ||
    sample.weatherCode !== null;
  if (!hasAny) {
    console.warn(`[weather] 응답에 유효 측정치 없음 — retryable 로 취급`);
    return null;
  }

  return sample;
}

/** 손목 온도 파싱 — Garmin activity rawData 의 maxTemperature/minTemperature. */
export function parseWristTemps(rawData: unknown): {
  max: number | null;
  min: number | null;
} {
  if (!rawData || typeof rawData !== "object") return { max: null, min: null };
  const raw = rawData as {
    maxTemperature?: number | null;
    minTemperature?: number | null;
  };
  const max = typeof raw.maxTemperature === "number" && Number.isFinite(raw.maxTemperature) ? raw.maxTemperature : null;
  const min = typeof raw.minTemperature === "number" && Number.isFinite(raw.minTemperature) ? raw.minTemperature : null;
  return { max, min };
}

/**
 * 활동 rawData 에서 UTC 시작 시각 추출 (Garmin `startTimeGMT` = "YYYY-MM-DD HH:mm:ss" naive).
 * Codex P2 (#269): DB.startTime 은 KST(+09:00) 로 하드코딩 저장돼 국외 활동의 UTC 가 어긋나므로,
 * 기상 조회에는 반드시 rawData 의 GMT 값을 우선 사용.
 */
export function getActivityStartUtc(
  rawData: unknown,
  fallback: Date,
): Date {
  if (rawData && typeof rawData === "object") {
    const raw = rawData as { startTimeGMT?: string | null };
    if (typeof raw.startTimeGMT === "string" && raw.startTimeGMT.length > 0) {
      const d = new Date(`${raw.startTimeGMT.replace(" ", "T")}+00:00`);
      if (Number.isFinite(d.getTime())) return d;
    }
  }
  return fallback;
}

/** 활동 rawData 에서 GPS 시작점 (Garmin: startLatitude/startLongitude). 실내 러닝은 null. */
export function getActivityStartLocation(rawData: unknown): { lat: number; lng: number } | null {
  if (!rawData || typeof rawData !== "object") return null;
  const raw = rawData as {
    startLatitude?: number | null;
    startLongitude?: number | null;
  };
  const lat = raw.startLatitude;
  const lng = raw.startLongitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
