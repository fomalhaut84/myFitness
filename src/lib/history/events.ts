/**
 * #396 (M15-4): 이벤트 마커 소스 조회 (서버 전용 — prisma). 순수 매핑은 `markers.ts`.
 */
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { RACE_EVENT_TYPE } from "@/lib/garmin/parse-event-type";
import { kstDayRange } from "./buckets";
import { MARKER_METRIC_FIELDS, METRIC_FIELD_LABELS, raceDetail, type HistoryEvent } from "./markers";
import { historyDayPath } from "./route-params";

const PROFILE_PATH = "/settings/profile";
const TRAINING_PLAN_PATH = "/training-plan";
const PLAN_DISTANCE_LABELS: Record<string, string> = { "5K": "5K", "10K": "10K", HM: "하프", FM: "풀" };

/** [from, to] (ymd, inclusive) 와 겹치는 이벤트 전부. 플랜은 기간이 걸치기만 해도 포함. 정렬은 호출자 몫. */
export async function loadHistoryEvents(range: { from: string; to: string }): Promise<HistoryEvent[]> {
  const start = kstDayRange(range.from).start;
  const end = kstDayRange(range.to).end;
  const [races, changes, plans] = await Promise.all([
    prisma.activity.findMany({
      where: { eventType: RACE_EVENT_TYPE, startTime: { gte: start, lt: end } },
      select: { startTime: true, name: true, distance: true, avgPace: true, duration: true },
    }),
    prisma.metricChange.findMany({
      where: { field: { in: [...MARKER_METRIC_FIELDS] }, changedAt: { gte: start, lt: end } },
      select: { field: true, oldValue: true, newValue: true, changedAt: true },
    }),
    prisma.trainingPlan.findMany({
      where: { startDate: { lt: end }, endDate: { gte: start } },
      select: { startDate: true, endDate: true, weekCount: true, weeklyFrequency: true, targetDistance: true, status: true },
    }),
  ]);

  const raceEvents = races.map((r): HistoryEvent => {
    const ymd = ymdKST(r.startTime);
    return { kind: "race", ymd, endYmd: null, title: r.name, detail: raceDetail(r.distance, r.avgPace, r.duration), href: historyDayPath(ymd) };
  });
  const metricEvents = changes.map((c): HistoryEvent => {
    const label = METRIC_FIELD_LABELS[c.field as (typeof MARKER_METRIC_FIELDS)[number]] ?? c.field;
    const fmt = (v: number) => String(Math.round(v));
    // oldValue null = 처음 설정 · newValue null = 삭제 (profile-history.ts 규칙)
    const title =
      c.oldValue === null && c.newValue !== null
        ? `${label} ${fmt(c.newValue)} (처음 설정)`
        : c.newValue === null && c.oldValue !== null
          ? `${label} ${fmt(c.oldValue)} 삭제`
          : `${label} ${c.oldValue === null ? "—" : fmt(c.oldValue)} → ${c.newValue === null ? "—" : fmt(c.newValue)}`;
    return { kind: "metric", ymd: ymdKST(c.changedAt), endYmd: null, title, detail: null, href: PROFILE_PATH };
  });
  const planEvents = plans.map((p): HistoryEvent => {
    const distance = p.targetDistance ? PLAN_DISTANCE_LABELS[p.targetDistance] ?? p.targetDistance : null;
    return {
      kind: "plan",
      ymd: ymdKST(p.startDate),
      endYmd: ymdKST(p.endDate),
      title: `${distance ? `${distance} ` : ""}플랜 ${p.weekCount}주`,
      detail: `주 ${p.weeklyFrequency}회${p.status === "active" ? " · 진행 중" : ""}`,
      href: TRAINING_PLAN_PATH,
    };
  });
  return [...raceEvents, ...metricEvents, ...planEvents];
}
