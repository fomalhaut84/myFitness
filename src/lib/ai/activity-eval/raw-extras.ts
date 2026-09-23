// #440: `Activity.rawData` 에서 컬럼으로 승격되지 않은 보조 지표를 뽑는다 (로컬 실측 키 기준). 순수 — 로더가 호출하고 결과만 DTO 에 싣는다.
// rawData 는 타입이 없어 키 오타 · 형식 변화가 조용히 null 이 된다 (memory `project_garmin_spo2_field_casing`) — 형태를 검사하고, Garmin 이 없는 지표를 0 으로 주는 필드는 0 을 결측으로 본다.

export interface RawExtras {
  /** `activityTrainingLoad` */
  trainingLoad: number | null;
  /** `trainingEffectLabel` (예: MAINTAINING · IMPROVING · RECOVERY) */
  trainingEffectLabel: string | null;
  /** `aerobicTrainingEffectMessage` */
  aerobicTEMessage: string | null;
  avgPower: number | null;
  normPower: number | null;
  maxPower: number | null;
  /** `vO2MaxValue` — 활동 시점 Garmin 추정 */
  vo2maxValue: number | null;
  movingDurationSec: number | null;
  elapsedDurationSec: number | null;
  /** `avgVerticalRatio` (%) */
  verticalRatioPct: number | null;
  /** `avgGroundContactBalance` (% 왼발) */
  groundContactBalancePct: number | null;
  /** `fastestSplit_1000` (초) */
  fastestSplit1000Sec: number | null;
  /** `differenceBodyBattery` — 0 도 값 */
  bodyBatteryDiff: number | null;
}

const EMPTY: RawExtras = {
  trainingLoad: null,
  trainingEffectLabel: null,
  aerobicTEMessage: null,
  avgPower: null,
  normPower: null,
  maxPower: null,
  vo2maxValue: null,
  movingDurationSec: null,
  elapsedDurationSec: null,
  verticalRatioPct: null,
  groundContactBalancePct: null,
  fastestSplit1000Sec: null,
  bodyBatteryDiff: null,
};

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 양수만 값 — Garmin 은 없는 지표를 0 으로 준다 */
function positive(v: unknown): number | null {
  const n = toNumber(v);
  return n !== null && n > 0 ? n : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export function extractRawExtras(rawData: unknown): RawExtras {
  if (rawData === null || typeof rawData !== "object" || Array.isArray(rawData)) return { ...EMPTY };
  const raw = rawData as Record<string, unknown>;
  return {
    trainingLoad: positive(raw.activityTrainingLoad),
    trainingEffectLabel: text(raw.trainingEffectLabel),
    aerobicTEMessage: text(raw.aerobicTrainingEffectMessage),
    avgPower: positive(raw.avgPower),
    normPower: positive(raw.normPower),
    maxPower: positive(raw.maxPower),
    vo2maxValue: positive(raw.vO2MaxValue),
    movingDurationSec: positive(raw.movingDuration),
    elapsedDurationSec: positive(raw.elapsedDuration),
    verticalRatioPct: positive(raw.avgVerticalRatio),
    groundContactBalancePct: positive(raw.avgGroundContactBalance),
    fastestSplit1000Sec: positive(raw.fastestSplit_1000),
    bodyBatteryDiff: toNumber(raw.differenceBodyBattery),
  };
}
