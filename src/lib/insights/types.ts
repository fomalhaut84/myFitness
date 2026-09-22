// #397 (M15-5): `/insights` 입력 행. 러닝 활동 1건 — 4 패널이 같은 배열을 쓴다 (조회 1회).
import type { ZoneDistribution } from "@/lib/fitness/intensity";

export interface InsightRun {
  id: string;
  ymd: string;
  year: number;
  distanceM: number;
  durationSec: number;
  /** 초/km */
  avgPace: number;
  avgHR: number | null;
  /** 외부 기상 기온 (손목 온도 아님 — memory `project_weather_wrist_separation`) */
  tempC: number | null;
  humidityPct: number | null;
  zones: ZoneDistribution | null;
  race: boolean;
}

export interface InsightContext {
  today: string;
  lowerBound: string;
}
