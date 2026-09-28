// #397 (M15-5): `/insights` 입력 행. 러닝 활동 1건 — 4 패널이 같은 배열을 쓴다 (조회 1회).
import type { ZoneDistribution } from "@/lib/fitness/intensity";

export interface InsightRun {
  id: string;
  ymd: string;
  year: number;
  /** GPS 없는 트레드밀 등은 null — 산점도 (`usableRuns`) 에서만 거른다. 존 패널은 거리와 무관 (PR #417 Codex P2) */
  distanceM: number | null;
  durationSec: number;
  /** 초/km · 거리 없으면 null */
  avgPace: number | null;
  avgHR: number | null;
  /** 외부 기상 기온 (손목 온도 아님 — memory `project_weather_wrist_separation`) */
  tempC: number | null;
  humidityPct: number | null;
  zones: ZoneDistribution | null;
  race: boolean;
  /** #425: 종료 후 2분 HRR (`Activity.hrr2`, 양수 = 회복). 백필 전 · 하루 심박 없음 · 결측이면 null */
  hrr2: number | null;
}

export interface InsightContext {
  today: string;
  lowerBound: string;
}

/** 산점도용 — 거리 · 페이스가 있는 러닝 (`usableRuns` 가 좁힌다) */
export type UsableRun = InsightRun & { distanceM: number; avgPace: number };
