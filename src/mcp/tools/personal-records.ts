// #455 F2: MCP get_personal_records — 전 기간 개인 기록 (/trends 개인 기록 패널과 같은 정의). 웹 API 경유 (web-api.ts).
// 리포트가 "오늘/이번 주 신기록" 을 말할 수 있게 — 기록의 id · ymd 가 오늘/이번 주 활동과 같으면 신기록.
import { formatPaceMinKm } from "./aggregate";
import { errorPayload, fetchWebJson } from "./web-api";

interface RecordRun {
  id: string;
  ymd: string;
  name: string;
  distanceM: number | null;
  durationSec: number;
  avgPace: number | null;
  race?: boolean;
}

interface RecordsResponse {
  lowerBound: string;
  today: string;
  byBucket: Record<string, RecordRun | null>;
  longest: RecordRun | null;
  bestMonth: unknown;
  bestVo2max: unknown;
  lowestRestingHR: unknown;
  bestHrr2: unknown;
  races: RecordRun[];
}

const CONTEXT_NOTE =
  "전 기간 [lowerBound, today] 개인 기록 — /trends 개인 기록 패널과 같은 정의. byBucket 은 거리 버킷 (5k · 10k · HM · FM) 별 최저 평균 페이스, longest 는 최장 거리, bestHrr2 는 가장 큰 2분 HRR (인터벌 · 레이스가 크게 나온다), bestMonth 는 최다 km 월, races 는 레이스 활동 최근순. " +
  "동률은 먼저 달성한 날. 오늘 (이브닝) 또는 이번 주 (주간) 러닝의 id/ymd 가 byBucket · longest · bestHrr2 와 같으면 그 항목의 신기록 — 그때만 언급. 페이스는 paceMinKm (분'초\"/km).";

function isRecordsResponse(v: unknown): v is RecordsResponse {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.lowerBound === "string" && typeof o.today === "string" && !!o.byBucket && typeof o.byBucket === "object" && Array.isArray(o.races);
}

function withPace<T extends RecordRun | null>(run: T): T extends null ? null : RecordRun & { paceMinKm: string | null } {
  if (run === null) return null as never;
  return { ...run, paceMinKm: run.avgPace !== null && run.avgPace > 0 ? formatPaceMinKm(run.avgPace) : null } as never;
}

export async function getPersonalRecords() {
  const res = await fetchWebJson("/api/history/records", "개인 기록");
  if (!res.ok) return errorPayload(res.error);
  if (!isRecordsResponse(res.body)) return errorPayload("개인 기록 응답 형태가 예상과 다릅니다");
  const r = res.body;
  const byBucket = Object.fromEntries(Object.entries(r.byBucket).map(([k, v]) => [k, withPace(v)]));
  const payload = {
    _context: CONTEXT_NOTE,
    lowerBound: r.lowerBound,
    today: r.today,
    byBucket,
    longest: withPace(r.longest),
    bestMonth: r.bestMonth,
    bestVo2max: r.bestVo2max,
    lowestRestingHR: r.lowestRestingHR,
    bestHrr2: r.bestHrr2,
    races: r.races.map((x) => withPace(x)),
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
