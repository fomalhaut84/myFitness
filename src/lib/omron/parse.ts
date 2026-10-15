/**
 * #514: OMRON Connect 응답 파싱 (순수 — 네트워크 · prisma 의존 없음).
 * 응답 구조는 자체 PoC 실측 (docs/specs/514-omron-direct-sync.md §2) 기준. 외부 JSON 이라 zod 로 검증한다.
 */
import { z } from "zod";

/** 기기 카테고리 (deviceCategory) */
export const OMRON_DEVICE_CATEGORY = {
  bloodPressure: "0",
  scale: "1",
} as const;

/** bodyIndexList 코드 — 사용자 OMRON 앱 화면 대조로 확정한 것만 (스펙 §2-3) */
const BP_CODE = { systolic: "1", diastolic: "2", pulse: "3" } as const;
const SCALE_CODE = {
  weightKg: "257",
  bmi: "262",
  bodyFatPct: "259",
  skeletalMusclePct: "261",
  skeletalMuscleKg: "294",
  visceralFatLevel: "264",
  basalMetabolism: "260",
  bodyAge: "263",
} as const;

export interface OmronDevice {
  category: string;
  model: string | null;
  serial: string;
  user: number;
}

export interface OmronMeasure {
  measuredAt: Date;
  /** 코드 → 실수값 (value × 10^exponent). 숫자로 읽을 수 없는 코드는 빠진다 */
  values: Record<string, number>;
}

export interface OmronBpReading {
  measuredAt: Date;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  values: Record<string, number>;
}

export interface OmronScaleReading {
  measuredAt: Date;
  weightKg: number;
  bmi: number | null;
  bodyFatPct: number | null;
  skeletalMusclePct: number | null;
  skeletalMuscleKg: number | null;
  visceralFatLevel: number | null;
  basalMetabolism: number | null;
  bodyAge: number | null;
  values: Record<string, number>;
}

const indexEntrySchema = z.array(z.union([z.string(), z.number()]));

const measureSchema = z.object({
  measureDateTo: z.number().int().positive(),
  bodyIndexList: z.record(z.string(), indexEntrySchema),
});

const measureListHolderSchema = z.object({
  deviceModelList: z
    .array(
      z.object({
        deviceSerialIDList: z.array(z.object({ measureList: z.array(z.unknown()).nullish() })),
      })
    )
    .nullish(),
});

const deviceListSchema = z.object({
  syncList: z.array(
    z.object({
      deviceCategoryList: z
        .array(
          z.object({
            deviceCategory: z.union([z.string(), z.number()]).nullish(),
            deviceModelList: z.array(
              z.object({
                deviceModel: z.string().nullish(),
                deviceSerialIDList: z.array(
                  z.object({
                    deviceSerialID: z.string(),
                    userNumberInDevice: z.union([z.string(), z.number()]),
                  })
                ),
              })
            ),
          })
        )
        .nullish(),
    })
  ),
  nextPaginationKey: z.union([z.string(), z.number()]).nullish(),
});

/** [value, unitCode, exponent, …] → value × 10^exponent. 부동소수 오차는 지수 자릿수로 정리 */
function decodeIndexEntry(entry: Array<string | number>): number | null {
  const value = Number(entry[0]);
  const exponent = Number(entry[2] ?? 0);
  if (!Number.isFinite(value) || !Number.isInteger(exponent)) return null;
  const scaled = value * 10 ** exponent;
  return exponent < 0 ? Number(scaled.toFixed(-exponent)) : scaled;
}

function decodeValues(list: Record<string, Array<string | number>>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(list).flatMap(([code, entry]) => {
      const v = decodeIndexEntry(entry);
      return v === null ? [] : [[code, v] as const];
    })
  );
}

function unwrapReturnedValue(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return undefined;
  const rv = (json as { returnedValue?: unknown }).returnedValue;
  return Array.isArray(rv) ? rv[0] : rv;
}

export function parseMeasures(json: unknown): { measures: OmronMeasure[]; skipped: number; error?: string } {
  const returned = unwrapReturnedValue(json);
  // 서버 오류는 200 + returnedValue.errorCode 로 온다 — "측정 없음" (deviceModelList null) 과 구분
  if (typeof returned === "object" && returned !== null && "errorCode" in returned) {
    return { measures: [], skipped: 0, error: `measureData 오류: ${String((returned as { errorCode: unknown }).errorCode)}` };
  }
  const holder = measureListHolderSchema.safeParse(returned);
  if (!holder.success) {
    return { measures: [], skipped: 0, error: `measureData 형태 불일치: ${holder.error.issues[0]?.message ?? "unknown"}` };
  }
  const rawList = (holder.data.deviceModelList ?? []).flatMap((model) =>
    model.deviceSerialIDList.flatMap((dev) => dev.measureList ?? [])
  );
  const parsed = rawList.map((raw) => measureSchema.safeParse(raw));
  const measures = parsed.flatMap((p) =>
    p.success ? [{ measuredAt: new Date(p.data.measureDateTo), values: decodeValues(p.data.bodyIndexList) }] : []
  );
  return { measures, skipped: parsed.length - measures.length };
}

function pick(values: Record<string, number>, code: string): number | null {
  const v = values[code];
  return v === undefined ? null : v;
}

function positiveInt(v: number | null): number | null {
  return v !== null && v > 0 ? Math.round(v) : null;
}

export function toBpReading(m: OmronMeasure): OmronBpReading | null {
  const systolic = positiveInt(pick(m.values, BP_CODE.systolic));
  const diastolic = positiveInt(pick(m.values, BP_CODE.diastolic));
  if (systolic === null || diastolic === null) return null;
  return {
    measuredAt: m.measuredAt,
    systolic,
    diastolic,
    pulse: positiveInt(pick(m.values, BP_CODE.pulse)),
    values: m.values,
  };
}

export function toScaleReading(m: OmronMeasure): OmronScaleReading | null {
  const weightKg = pick(m.values, SCALE_CODE.weightKg);
  if (weightKg === null || weightKg <= 0) return null;
  return {
    measuredAt: m.measuredAt,
    weightKg,
    bmi: pick(m.values, SCALE_CODE.bmi),
    bodyFatPct: pick(m.values, SCALE_CODE.bodyFatPct),
    skeletalMusclePct: pick(m.values, SCALE_CODE.skeletalMusclePct),
    skeletalMuscleKg: pick(m.values, SCALE_CODE.skeletalMuscleKg),
    visceralFatLevel: pick(m.values, SCALE_CODE.visceralFatLevel),
    basalMetabolism: positiveInt(pick(m.values, SCALE_CODE.basalMetabolism)),
    bodyAge: positiveInt(pick(m.values, SCALE_CODE.bodyAge)),
    values: m.values,
  };
}

/** 등록 기기 응답 → (serial, user) 고유 기기. user 0 은 기기 공용 슬롯이라 제외 */
export function parseDevices(json: unknown): { devices: OmronDevice[]; nextPageKey: number | null; error?: string } {
  const parsed = deviceListSchema.safeParse(unwrapReturnedValue(json));
  if (!parsed.success) {
    return { devices: [], nextPageKey: null, error: `기기 목록 형태 불일치: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  const all = parsed.data.syncList.flatMap((sync) =>
    (sync.deviceCategoryList ?? []).flatMap((cat) =>
      cat.deviceModelList.flatMap((model) =>
        model.deviceSerialIDList.map((dev) => ({
          category: String(cat.deviceCategory ?? ""),
          model: model.deviceModel ?? null,
          serial: dev.deviceSerialID,
          user: Number(dev.userNumberInDevice),
        }))
      )
    )
  );
  const unique = new Map(
    all.filter((d) => Number.isInteger(d.user) && d.user !== 0).map((d) => [`${d.serial}:${d.user}`, d] as const)
  );
  const key = Number(parsed.data.nextPaginationKey ?? 0);
  return { devices: [...unique.values()], nextPageKey: Number.isFinite(key) && key > 0 ? key : null };
}
