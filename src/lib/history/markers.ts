/**
 * #396 (M15-4): `/trends` 시계열 위 이벤트 마커 — **순수** (클라이언트 차트가 import 한다. prisma 조회는 `events.ts`).
 * 소스 3종 — 레이스 (`Activity.eventType = "race"`) · 지표 변경 (`MetricChange.field ∈ {maxHR, lthr}`) · 트레이닝 플랜 기간. 같은 버킷의 이벤트는 선 하나로 합친다 — 연 단위에서 레이스 3건이
 * 겹쳐 두꺼운 선 하나로 보이면 정보가 없다 (시안 결정 2).
 */
import { formatClock } from "@/lib/format";
import { formatPace } from "@/lib/running/buckets";
import { bucketKeyOf, type HistoryGranularity } from "./buckets";

export type HistoryEventKind = "race" | "metric" | "plan";

export interface HistoryEvent {
  kind: HistoryEventKind;
  ymd: string;
  /** 플랜만 — 기간의 끝 (inclusive) */
  endYmd: string | null;
  title: string;
  detail: string | null;
  href: string | null;
}

export const EVENT_KIND_LABELS: Record<HistoryEventKind, string> = {
  race: "레이스",
  metric: "maxHR · LTHR 변경",
  plan: "트레이닝 플랜",
};

/** 마커 대상 지표 변경 필드 (스펙 D7: maxHR · LTHR). `lthrPace` · `vo2maxRunning` 등은 제외. */
export const MARKER_METRIC_FIELDS = ["maxHR", "lthr"] as const;
export const METRIC_FIELD_LABELS: Record<(typeof MARKER_METRIC_FIELDS)[number], string> = { maxHR: "maxHR", lthr: "LTHR" };

export interface ChartMarkerLine {
  key: string;
  /** 레이스가 하나라도 있으면 true — 실선 · 밝은 색 */
  race: boolean;
  /** `R` · `R+1` · `×2` · 빈 문자열 */
  label: string;
  events: HistoryEvent[];
}

export interface ChartMarkerBand {
  fromKey: string;
  toKey: string;
  event: HistoryEvent;
}

export interface ChartMarkers {
  lines: ChartMarkerLine[];
  bands: ChartMarkerBand[];
}

export function markerLabel(events: readonly HistoryEvent[]): string {
  const races = events.filter((e) => e.kind === "race").length;
  if (races > 0) return events.length > 1 ? `R+${events.length - 1}` : "R";
  return events.length > 1 ? `×${events.length}` : "";
}

/**
 * 이벤트 → 차트 좌표 (버킷 키). 버킷 목록에 없는 키는 버린다 (조회 범위는 summary 와 같지만 첫 버킷이 하한 앞으로
 * 걸치는 주 · 연 단위를 위해 키 기준으로 한 번 더 거른다). 플랜은 양 끝을 첫/마지막 버킷으로 클램프하고, 연 단위에서는
 * 밴드를 만들지 않는다 (6주 플랜이 한 해를 덮는다 — 시안 결정 3). 목록에는 남는다.
 */
export function toChartMarkers(
  events: readonly HistoryEvent[],
  bucketKeys: readonly string[],
  granularity: HistoryGranularity,
): ChartMarkers {
  if (bucketKeys.length === 0) return { lines: [], bands: [] };
  const keySet = new Set(bucketKeys);
  const firstKey = bucketKeys[0];
  const lastKey = bucketKeys[bucketKeys.length - 1];

  const byKey = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    if (event.kind === "plan") continue;
    const key = bucketKeyOf(event.ymd, granularity);
    if (!keySet.has(key)) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), event]);
  }
  const lines = bucketKeys
    .filter((key) => byKey.has(key))
    .map((key) => {
      const group = byKey.get(key) as HistoryEvent[];
      return { key, race: group.some((e) => e.kind === "race"), label: markerLabel(group), events: group };
    });

  const bands =
    granularity === "year"
      ? []
      : events.flatMap((event): ChartMarkerBand[] => {
          if (event.kind !== "plan" || event.endYmd === null) return [];
          const start = bucketKeyOf(event.ymd, granularity);
          const end = bucketKeyOf(event.endYmd, granularity);
          const fromKey = start < firstKey ? firstKey : start;
          const toKey = end > lastKey ? lastKey : end;
          if (fromKey > toKey || !keySet.has(fromKey) || !keySet.has(toKey)) return [];
          return [{ fromKey, toKey, event }];
        });

  return { lines, bands };
}

export function raceDetail(distanceM: number | null, avgPace: number | null, durationSec: number): string {
  const parts: string[] = [];
  if (distanceM !== null) parts.push(`${(distanceM / 1000).toFixed(2)}km`);
  if (avgPace !== null) parts.push(`${formatPace(avgPace)}/km`);
  parts.push(formatClock(durationSec));
  return parts.join(" · ");
}
