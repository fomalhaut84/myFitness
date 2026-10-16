// #544: 복용 기간 타임라인 좌표 — 연 단위 축 · 장기 막대 (같은 이름 · 종류는 한 줄) · 단기 점 · 검진 회차 눈금. 0~1 비율. 순수.
import { diffDaysYmd } from "@/lib/history/buckets";
import type { MedicationDto } from "./dto";

export interface TimelineBar {
  id: string;
  x0: number;
  /** 복용 중 · 종료일이 오늘 뒤면 오늘까지 */
  x1: number;
}

export interface TimelineLane {
  key: string;
  name: string;
  kind: MedicationDto["kind"];
  bars: TimelineBar[];
}

export interface Timeline {
  years: { year: number; x: number }[];
  lanes: TimelineLane[];
  shortDots: { id: string; name: string; x: number }[];
  checkups: { date: string; x: number }[];
}

export function buildTimeline(meds: readonly MedicationDto[], checkupDates: readonly string[], todayYmd: string): Timeline | null {
  if (meds.length === 0) return null;
  const firstYear = Math.min(...[...meds.map((m) => m.startDate), ...checkupDates].map((d) => Number(d.slice(0, 4))));
  const lastYear = Number(todayYmd.slice(0, 4)) + 1;
  const axisStart = `${firstYear}-01-01`;
  const span = diffDaysYmd(axisStart, `${lastYear}-01-01`);
  const x = (ymd: string) => Math.min(1, Math.max(0, diffDaysYmd(axisStart, ymd) / span));

  const lanes = new Map<string, TimelineLane>();
  for (const med of [...meds].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    if (med.regimen !== "long_term") continue;
    const key = `${med.kind}:${med.name}`;
    const lane = lanes.get(key) ?? { key, name: med.name, kind: med.kind, bars: [] };
    const end = med.endDate === null || med.endDate > todayYmd ? todayYmd : med.endDate;
    lanes.set(key, { ...lane, bars: [...lane.bars, { id: med.id, x0: x(med.startDate), x1: x(end) }] });
  }
  return {
    years: Array.from({ length: lastYear - firstYear + 1 }, (_, i) => ({ year: firstYear + i, x: x(`${firstYear + i}-01-01`) })),
    lanes: [...lanes.values()],
    shortDots: meds.filter((m) => m.regimen === "short_term").map((m) => ({ id: m.id, name: m.name, x: x(m.startDate) })),
    checkups: checkupDates.map((date) => ({ date, x: x(date) })),
  };
}
