// #440: 활동 AI 평가 입력 DTO — 로더 (`load.ts`, prisma · Garmin) 가 만들고 빌더 (`build-context.ts`, 순수) 가 읽는다.
// 직렬화 가능한 값만 — rawData 는 로더가 `extractRawExtras` 로 뽑아 `extras` 에 넣고, 빌더는 rawData 를 모른다.
import type { ZoneDistribution } from "@/lib/fitness/intensity";
import type { RecoveryDTO } from "@/lib/heart/load-recovery";
import type { Bucket } from "@/lib/running/buckets";
import type { RawExtras } from "./raw-extras";
import type { EvalLap } from "./splits";

export interface EvalActivity {
  id: string;
  name: string;
  activityType: string;
  /** UTC ISO */
  startIso: string;
  /** KST 날짜 */
  ymd: string;
  durationSec: number;
  distanceM: number | null;
  calories: number | null;
  avgHR: number | null;
  maxHR: number | null;
  /** 초/km */
  avgPace: number | null;
  elevationGainM: number | null;
  avgCadence: number | null;
  avgStrideLengthM: number | null;
  avgVerticalOscillationCm: number | null;
  avgGroundContactTimeMs: number | null;
  aerobicTE: number | null;
  anaerobicTE: number | null;
  avgRespirationRate: number | null;
  lapCount: number | null;
  vo2maxEstimate: number | null;
  zoneDistribution: ZoneDistribution | null;
  estimatedZone: number | null;
  intensityScore: number | null;
  intensityLabel: string | null;
  routeTag: string | null;
  wristTempMaxC: number | null;
  wristTempMinC: number | null;
  weatherTempC: number | null;
  weatherApparentTempC: number | null;
  weatherHumidityPct: number | null;
  weatherWindMs: number | null;
  weatherPrecipMm: number | null;
  weatherCode: number | null;
  hrr2: number | null;
  hrrDrop10: number | null;
}

/** 비교 대상 러닝 1건 — 같은 코스 (#261) 또는 비슷한 거리 */
export interface ComparisonRun {
  id: string;
  ymd: string;
  name: string;
  distanceM: number | null;
  avgPace: number | null;
  avgHR: number | null;
  avgCadence: number | null;
  hrr2: number | null;
  intensityLabel: string | null;
  routeTag: string | null;
}

/** 같은 해 러닝의 2분 HRR 중앙값 (5건 미만이면 로더가 null) */
export interface HrrBaseline {
  year: number;
  median: number;
  n: number;
}

/** 거리 버킷 전 기간 최저 페이스 1건 — 이 활동 자신일 수 있다 */
export interface BucketBest {
  bucket: Bucket;
  activityId: string;
  ymd: string;
  avgPace: number;
}

export interface EvalInput {
  activity: EvalActivity;
  extras: RawExtras;
  /** 러닝 계열만 로드 — 그 외 null */
  recovery: RecoveryDTO | null;
  /** null = Garmin 스플릿 조회 실패 (섹션 생략 + omitted). [] = km 랩 없음 (조용히 생략) */
  laps: EvalLap[] | null;
  sameCourse: ComparisonRun[];
  similarDistance: ComparisonRun[];
  hrrBaseline: HrrBaseline | null;
  bucketBest: BucketBest | null;
}

export type EvalSectionId = "basic" | "splits" | "intensity" | "recovery" | "dynamics" | "extra" | "environment" | "comparison";

export interface EvalSection {
  id: EvalSectionId;
  title: string;
  lines: string[];
}

/** 데이터가 있어야 하는데 못 가져온 섹션 — 결측 (원래 없음) 과 구분한다 */
export interface EvalOmitted {
  id: EvalSectionId;
  title: string;
  reason: string;
}

export type EvalMode = "full" | "brief";

export interface EvalContext {
  mode: EvalMode;
  sections: EvalSection[];
  omitted: EvalOmitted[];
  prompt: string;
}
