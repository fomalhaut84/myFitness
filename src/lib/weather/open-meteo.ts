// #269: Open-Meteo Archive API 어댑터. 활동 시작 시점의 실제 기상 (온도/체감/습도/풍속/강수/날씨코드) 조회.
// - 인증 불필요, 무료.
// - Archive endpoint 는 과거 데이터. 실시간 예보와는 다름.
// - 활동 시간대 커버 강수량은 시간별 배열 합산 (활동 시작~끝 시간 인덱스 범위).
// - 에러는 상위에서 관용 처리 — sync 는 실패해도 계속 진행 (activity 자체는 저장).

const ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";
const DEFAULT_TIMEOUT_MS = 8000;

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

/** 두 Date 사이 (start ≤ t ≤ end) 를 커버하는 hour key 배열. inclusive. */
function hourKeysCovering(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCMinutes(0, 0, 0);
  const stop = new Date(end);
  stop.setUTCMinutes(0, 0, 0);
  while (cursor.getTime() <= stop.getTime()) {
    keys.push(hourKeyUtc(cursor));
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return keys;
}

function sumAt(values: (number | null)[] | undefined, indices: number[]): number | null {
  if (!values) return null;
  let sum = 0;
  let count = 0;
  for (const i of indices) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum : null;
}

function pickAt(values: (number | null)[] | undefined, index: number): number | null {
  if (!values) return null;
  const v = values[index];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface FetchArchiveOptions {
  timeoutMs?: number;
  /** injection point for testing */
  fetchImpl?: typeof fetch;
}

/**
 * 특정 GPS + 활동 시간대의 기상 요약을 반환. 실패 시 null (에러 throw 안 함 — 상위 sync 안전).
 * duration 은 초 단위. start 시각 (UTC) 부터 duration 만큼 커버하는 hourly 배열을 합산.
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

  const url = new URL(ARCHIVE_ENDPOINT);
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

  let response: Response;
  try {
    response = await doFetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    console.warn(`[weather] fetch 실패 (network/timeout): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    console.warn(`[weather] HTTP ${response.status} — ${await response.text().catch(() => "")}`);
    return null;
  }

  let body: ArchiveResponse;
  try {
    body = (await response.json()) as ArchiveResponse;
  } catch (err) {
    console.warn(`[weather] JSON parse 실패: ${err instanceof Error ? err.message : String(err)}`);
    return null;
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

  const coverKeys = hourKeysCovering(startTimeUtc, end);
  const coverIndices = coverKeys
    .map((k) => times.indexOf(k))
    .filter((i) => i >= 0);

  return {
    tempC: pickAt(hourly.temperature_2m, startIndex),
    apparentTempC: pickAt(hourly.apparent_temperature, startIndex),
    humidityPct: (() => {
      const v = pickAt(hourly.relative_humidity_2m, startIndex);
      return v !== null ? Math.round(v) : null;
    })(),
    windMs: pickAt(hourly.wind_speed_10m, startIndex),
    precipMm: sumAt(hourly.precipitation, coverIndices.length > 0 ? coverIndices : [startIndex]),
    weatherCode: (() => {
      const v = pickAt(hourly.weather_code, startIndex);
      return v !== null ? Math.round(v) : null;
    })(),
    source: "open-meteo",
  };
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
