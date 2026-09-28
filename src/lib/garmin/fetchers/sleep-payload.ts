// #437: 수면 fetcher 의 upsert payload 조립 — 순수 (Prisma 호출 없음). 회귀 테스트가 걸리도록 `sleep.ts` 에서 분리.
// 규칙: update 에서 null 필드는 생략 (`withoutNulls`), 응답이 기존보다 빈약하면 (`trimmed`) `rawData` 와 `sleepScoreDetails` 둘 다 생략 (기존 유지).
// 이전에는 `trimmed` 여도 `sleepScoreDetails` 를 넣어, 부분 `sleepScores` (overall 만) 가 기존 JSON 을 null 섞인 값으로 덮어썼다 (릴리즈 PR #434 Codex P2).
import type { SleepDTO, SleepData } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import { preserveUpdate } from "../preserve";
import { extractSleepSpO2 } from "./sleep-spo2";

/** `SleepRecord.sleepScoreDetails` JSON 의 정규화 형태 */
export interface SleepScoreDetails {
  overall: number | null;
  duration: string | null;
  stress: string | null;
  awakeCount: string | null;
  remPercentage: { value: number | null; qualifier: string | null };
  deepPercentage: { value: number | null; qualifier: string | null };
  lightPercentage: { value: number | null; qualifier: string | null };
  restlessness: string | null;
}

/** upsert `create` 에 date 를 더하면 되는 컬럼 묶음. `preserveUpdate` 의 `Record<string, unknown>` 제약 때문에 interface 가 아닌 type */
export type SleepRecordData = {
  sleepStart: Date;
  sleepEnd: Date;
  totalSleep: number;
  deepSleep: number | null;
  lightSleep: number | null;
  remSleep: number | null;
  awakeDuration: number | null;
  sleepScore: number | null;
  avgSpO2: number | null;
  lowestSpO2: number | null;
  highestSpO2: number | null;
  avgRespiration: number | null;
  lowestRespiration: number | null;
  highestRespiration: number | null;
  avgSleepStress: number | null;
  bodyBatteryChange: number | null;
  restingHR: number | null;
  hrvOvernight: number | null;
  rawData: Prisma.InputJsonValue;
};

export type SleepUpdatePayload = Partial<SleepRecordData> & { sleepScoreDetails?: Prisma.InputJsonValue };

/** 실응답은 타입보다 빈약할 수 있어 (부분 `sleepScores`) 모든 잎을 optional chaining 으로 읽는다 */
export function buildSleepScoreDetails(dto: SleepDTO): SleepScoreDetails | null {
  const scores = dto.sleepScores as Partial<SleepDTO["sleepScores"]> | undefined;
  if (!scores) return null;
  return {
    overall: scores.overall?.value ?? null,
    duration: scores.totalDuration?.qualifierKey ?? null,
    stress: scores.stress?.qualifierKey ?? null,
    awakeCount: scores.awakeCount?.qualifierKey ?? null,
    remPercentage: {
      value: scores.remPercentage?.value ?? null,
      qualifier: scores.remPercentage?.qualifierKey ?? null,
    },
    deepPercentage: {
      value: scores.deepPercentage?.value ?? null,
      qualifier: scores.deepPercentage?.qualifierKey ?? null,
    },
    lightPercentage: {
      value: scores.lightPercentage?.value ?? null,
      qualifier: scores.lightPercentage?.qualifierKey ?? null,
    },
    restlessness: scores.restlessness?.qualifierKey ?? null,
  };
}

/** 초 → 분 (반올림). 0 · 결측은 null — 기존 동작 유지 (0초 단계는 "없음" 으로) */
const secondsToMinutes = (seconds: unknown): number | null => {
  const n = toFloat(seconds);
  return n ? Math.round(n / 60) : null;
};

/** 호출 전에 `dailySleepDTO` · 시작/종료 타임스탬프 존재를 fetcher 가 보장한다 */
export function buildSleepRecordData(sleepData: SleepData): SleepRecordData {
  const dto = sleepData.dailySleepDTO;
  const spo2 = extractSleepSpO2(sleepData);
  return {
    sleepStart: new Date(dto.sleepStartTimestampGMT),
    sleepEnd: new Date(dto.sleepEndTimestampGMT),
    totalSleep: Math.round(dto.sleepTimeSeconds / 60),
    deepSleep: secondsToMinutes(dto.deepSleepSeconds),
    lightSleep: secondsToMinutes(dto.lightSleepSeconds),
    remSleep: secondsToMinutes(dto.remSleepSeconds),
    awakeDuration: secondsToMinutes(dto.awakeSleepSeconds),
    sleepScore: dto.sleepScores?.overall?.value ?? null,
    avgSpO2: spo2.avg,
    lowestSpO2: spo2.lowest,
    highestSpO2: spo2.highest,
    avgRespiration: toFloat(dto.averageRespirationValue),
    lowestRespiration: toFloat(dto.lowestRespirationValue),
    highestRespiration: toFloat(dto.highestRespirationValue),
    avgSleepStress: toFloat(dto.avgSleepStress),
    bodyBatteryChange: toInt(sleepData.bodyBatteryChange),
    restingHR: toInt(sleepData.restingHeartRate),
    hrvOvernight: toFloat(sleepData.avgOvernightHrv),
    rawData: sleepData as unknown as Prisma.InputJsonValue,
  };
}

/**
 * upsert 의 `update` payload. `trimmed` (응답이 기존 rawData 보다 빈약) 면 `rawData` 와 `sleepScoreDetails` 를 함께 생략한다 —
 * 둘 다 응답 전체에서 파생된 JSON 이라 같은 보존 규칙. `sleepScoreDetails` 가 null 이면 키를 넣지 않는다 (Prisma update 는 null 을 받지 않는다 · #431).
 */
export function buildSleepUpdatePayload(
  data: SleepRecordData,
  scoreDetails: SleepScoreDetails | null,
  ctx: { trimmed: boolean }
): SleepUpdatePayload {
  const base: SleepUpdatePayload = preserveUpdate(data, ctx);
  if (ctx.trimmed || scoreDetails === null) return base;
  return { ...base, sleepScoreDetails: scoreDetails as unknown as Prisma.InputJsonValue };
}

export function toInt(val: unknown): number | null {
  const n = toFloat(val);
  return n === null ? null : Math.round(n);
}

export function toFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}
