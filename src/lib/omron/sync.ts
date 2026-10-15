/**
 * #514: OMRON 혈압 · 체성분 싱크. Garmin syncAll 루프가 dataType `omron_blood_pressure` · `omron_body_composition`
 * 으로 호출한다 (커서 · 백필 · SyncMetadata 는 루프가 관리).
 * 저장 규칙: OMRON 우선 · manual 보호 · 덮어쓴 Garmin 원본은 rawData.replacedGarmin 에 보존 (스펙 D1).
 */
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { aggregateBpByDay, pickDailyScale, type BpDay, type ScaleDay } from "./aggregate";
import { OmronClient } from "./client";
import { readOmronConfig, type OmronConfig } from "./config";
import {
  OMRON_DEVICE_CATEGORY,
  parseDevices,
  parseMeasures,
  toBpReading,
  toScaleReading,
  type OmronDevice,
  type OmronMeasure,
} from "./parse";
import { garminArchive, omronWriteAction, type OmronWriteAction } from "./write-policy";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 폰 앱이 늦게 올린 측정도 잡도록 요청 창을 항상 이만큼 앞당긴다 (업서트라 중복 무해) */
const LOOKBACK_DAYS = 7;
const MAX_DEVICE_PAGES = 20;

let sharedClient: { config: OmronConfig; client: OmronClient } | null = null;

/** 싱크 한 번에 두 타입이 같은 세션을 쓰도록 재사용. env 가 바뀌면 새로 만든다 */
function getClient(config: OmronConfig): OmronClient {
  if (sharedClient && JSON.stringify(sharedClient.config) === JSON.stringify(config)) return sharedClient.client;
  sharedClient = { config, client: new OmronClient(config) };
  return sharedClient.client;
}

export function isOmronEnabled(): boolean {
  return readOmronConfig().enabled;
}

function requireConfig(): OmronConfig {
  const result = readOmronConfig();
  if (!result.enabled) throw new Error(`OMRON 비활성 — env 누락: ${result.missing.join(", ")}`);
  return result.config;
}

async function listDevices(client: OmronClient, category: string): Promise<OmronDevice[]> {
  const collected: OmronDevice[] = [];
  let pageKey = 0;
  for (let page = 0; page < MAX_DEVICE_PAGES; page++) {
    const parsed = parseDevices(await client.callServerCode("synchronizeDeviceConfData", { countOnlyFlag: 0, lastSyncDate: pageKey }));
    if (parsed.error) throw new Error(parsed.error);
    collected.push(...parsed.devices);
    if (parsed.nextPageKey === null || parsed.nextPageKey === pageKey) break;
    pageKey = parsed.nextPageKey;
  }
  const unique = new Map(collected.map((d) => [`${d.serial}:${d.user}`, d] as const));
  return [...unique.values()].filter((d) => d.category === category);
}

async function fetchMeasures(client: OmronClient, device: OmronDevice, from: Date, to: Date): Promise<OmronMeasure[]> {
  const parsed = parseMeasures(
    await client.callServerCode("measureData", {
      containCorrectedDataFlag: 1,
      containAllDataTypeFlag: 1,
      deviceCategory: device.category,
      deviceSerialID: device.serial,
      userNumberInDevice: device.user,
      searchDateFrom: from.getTime(),
      searchDateTo: to.getTime(),
    })
  );
  if (parsed.error) throw new Error(parsed.error);
  if (parsed.skipped > 0) console.warn(`[omron] ${device.model ?? device.serial}: 형태가 다른 측정 ${parsed.skipped}건 skip`);
  return parsed.measures;
}

/** [startDate − LOOKBACK, endDate + 1일) — endDate 는 KST 자정이라 그날 전체를 포함하도록 */
function requestWindow(startDate: Date, endDate: Date): { from: Date; to: Date } {
  const to = new Date(Math.min(endDate.getTime() + DAY_MS, Date.now()));
  return { from: new Date(startDate.getTime() - LOOKBACK_DAYS * DAY_MS), to };
}

async function collectMeasures(category: string, startDate: Date, endDate: Date): Promise<{ measures: OmronMeasure[]; devices: OmronDevice[] }> {
  const client = getClient(requireConfig());
  const devices = await listDevices(client, category);
  const { from, to } = requestWindow(startDate, endDate);
  const perDevice = await Promise.all(devices.map((d) => fetchMeasures(client, d, from, to)));
  return { measures: perDevice.flat(), devices };
}

function deviceInfo(devices: readonly OmronDevice[]): Prisma.InputJsonValue {
  return devices.map((d) => ({ model: d.model, user: d.user }));
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

async function writeBpDay(day: BpDay, devices: readonly OmronDevice[]): Promise<OmronWriteAction> {
  const existing = await prisma.bloodPressure.findUnique({
    where: { date: day.date },
    select: { source: true, rawData: true, measurements: true },
  });
  const action = omronWriteAction(existing?.source ?? null);
  if (action === "skip") return action;

  const replacedGarmin = garminArchive(action, existing?.rawData, {
    rawData: existing?.rawData ?? null,
    measurements: existing?.measurements ?? null,
  }) as Prisma.InputJsonValue | undefined;
  const data = {
    highSystolic: day.highSystolic,
    lowSystolic: day.lowSystolic,
    highDiastolic: day.highDiastolic,
    lowDiastolic: day.lowDiastolic,
    avgPulse: day.avgPulse,
    measureCount: day.measureCount,
    category: day.category,
    measurements: day.measurements as unknown as Prisma.InputJsonValue,
    source: "omron",
    rawData: { provider: "omron", devices: deviceInfo(devices), ...(replacedGarmin ? { replacedGarmin } : {}) },
  };

  if (action === "create") {
    try {
      await prisma.bloodPressure.create({ data: { date: day.date, ...data } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return writeBpDay(day, devices); // 동시 싱크가 먼저 만들었다 → 그 출처 기준으로 다시 판정
    }
    return action;
  }
  // 조건부 갱신 — 읽은 뒤 출처가 바뀌었으면 (예: 다른 싱크) 덮지 않는다
  const updated = await prisma.bloodPressure.updateMany({ where: { date: day.date, source: existing!.source }, data });
  return updated.count > 0 ? action : "skip";
}

async function writeScaleDay(day: ScaleDay, devices: readonly OmronDevice[]): Promise<OmronWriteAction> {
  const existing = await prisma.bodyComposition.findUnique({
    where: { date: day.date },
    select: { source: true, rawData: true, weight: true, bmi: true, bodyFat: true, muscleMass: true },
  });
  const action = omronWriteAction(existing?.source ?? null);
  if (action === "skip") return action;

  const r = day.representative;
  const replacedGarmin = garminArchive(action, existing?.rawData, {
    weight: existing?.weight ?? null,
    bmi: existing?.bmi ?? null,
    bodyFat: existing?.bodyFat ?? null,
    muscleMass: existing?.muscleMass ?? null,
    rawData: existing?.rawData ?? null,
  }) as Prisma.InputJsonValue | undefined;
  const data = {
    weight: r.weightKg,
    bmi: r.bmi,
    bodyFat: r.bodyFatPct,
    muscleMass: r.skeletalMuscleKg,
    visceralFatLevel: r.visceralFatLevel,
    basalMetabolism: r.basalMetabolism,
    bodyAge: r.bodyAge,
    skeletalMusclePct: r.skeletalMusclePct,
    source: "omron",
    rawData: {
      provider: "omron",
      devices: deviceInfo(devices),
      representativeAt: r.measuredAt.toISOString(),
      // 그날 전체 측정 (대표 = 가장 이른 측정) — 미확정 코드 포함
      measurements: day.all.map((m) => ({ measuredAt: m.measuredAt.toISOString(), values: m.values })),
      ...(replacedGarmin ? { replacedGarmin } : {}),
    },
  };

  if (action === "create") {
    try {
      await prisma.bodyComposition.create({ data: { date: day.date, ...data } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return writeScaleDay(day, devices);
    }
    return action;
  }
  const updated = await prisma.bodyComposition.updateMany({ where: { date: day.date, source: existing!.source }, data });
  return updated.count > 0 ? action : "skip";
}

function logActions(label: string, actions: readonly OmronWriteAction[]): number {
  const counts = actions.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a]: (acc[a] ?? 0) + 1 }), {});
  if (actions.length > 0) console.log(`[omron] ${label}: ${JSON.stringify(counts)}`);
  return actions.filter((a) => a !== "skip").length;
}

/**
 * 날짜별로 저장하되 실패해도 나머지는 계속한다. 실패가 있으면 끝에 throw — 루프가 SyncMetadata 를 error 로 남기고
 * 커서를 전진시키지 않아 다음 싱크가 같은 범위를 재시도한다 (조용히 0건 성공으로 끝나지 않게).
 */
async function writeSequentially<T>(
  label: string,
  items: readonly T[],
  write: (item: T) => Promise<OmronWriteAction>
): Promise<OmronWriteAction[]> {
  const results: OmronWriteAction[] = [];
  const failures: string[] = [];
  for (const item of items) {
    try {
      results.push(await write(item));
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (failures.length > 0) {
    logActions(label, results);
    throw new Error(`OMRON ${label} ${failures.length}/${items.length}일 저장 실패: ${failures[0].slice(0, 300)}`);
  }
  return results;
}

/** 반환: 저장 (생성 · 교체 · 갱신) 된 날짜 수 */
export async function syncOmronBloodPressure(startDate: Date, endDate: Date): Promise<number> {
  const { measures, devices } = await collectMeasures(OMRON_DEVICE_CATEGORY.bloodPressure, startDate, endDate);
  const readings = measures.flatMap((m) => {
    const r = toBpReading(m);
    return r ? [r] : [];
  });
  const actions = await writeSequentially("혈압", aggregateBpByDay(readings), (day) => writeBpDay(day, devices));
  return logActions("혈압", actions);
}

export async function syncOmronBodyComposition(startDate: Date, endDate: Date): Promise<number> {
  const { measures, devices } = await collectMeasures(OMRON_DEVICE_CATEGORY.scale, startDate, endDate);
  const readings = measures.flatMap((m) => {
    const r = toScaleReading(m);
    return r ? [r] : [];
  });
  const actions = await writeSequentially("체성분", pickDailyScale(readings), (day) => writeScaleDay(day, devices));
  return logActions("체성분", actions);
}
