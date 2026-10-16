// #527 (2/2): 검진 화면 계산 — 범위 막대 좌표 · 수치 표기 · 직전 대비 · 추적검사 남은 기간. 순수 (React 무관).
import { getCheckupItem } from "./items";

/** 화면 판정 등급 — DB 의 normal 은 표시하지 않는다 */
export type FlagTone = "caution" | "abnormal" | null;

export function flagTone(flag: string | null): FlagTone {
  return flag === "caution" || flag === "abnormal" ? flag : null;
}

export const FLAG_LABEL: Record<"caution" | "abnormal", string> = { caution: "주의", abnormal: "이상" };

export const KIND_LABEL: Record<string, string> = { national: "국가검진", comprehensive: "종합검진", other: "기타" };

/** 항목 소수 자릿수 — 카탈로그 밖 항목은 원문 소수 자릿수를 따른다 (최대 3) */
export function itemDecimals(itemCode: string, valueText: string | null): number {
  const item = getCheckupItem(itemCode);
  if (item) return item.decimals;
  const frac = valueText?.split(".")[1];
  return frac ? Math.min(frac.length, 3) : 0;
}

/** 수치는 항목 자릿수로, 그 외는 원문 */
export function formatResultValue(r: { itemCode: string; valueNum: number | null; valueText: string | null }): string {
  if (r.valueNum === null) return r.valueText ?? "";
  return r.valueNum.toFixed(itemDecimals(r.itemCode, r.valueText));
}

/** 기준범위 표시 — 원문 우선 (기관 표기 그대로) */
export function formatReference(r: { refText: string | null }): string {
  return r.refText ?? "";
}

/**
 * 직전 대비 문자열. 둘 다 수치이고 단위가 같을 때만 차이 (`+9` · `−0.8` · `±0`), 아니면 null (호출자가 직전 원문만 보여 준다).
 */
export function formatDelta(
  itemCode: string,
  cur: { valueNum: number | null; valueText: string | null; unit: string | null },
  prev: { valueNum: number | null; unit: string | null } | null,
): string | null {
  if (!prev || cur.valueNum === null || prev.valueNum === null || (cur.unit ?? null) !== (prev.unit ?? null)) return null;
  const d = itemDecimals(itemCode, cur.valueText);
  const diff = Number((cur.valueNum - prev.valueNum).toFixed(d));
  if (diff === 0) return "±0";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(d)}`;
}

/* ── 범위 막대 ───────────────────────────────────────── */

export interface RailInput {
  value: number;
  previous: number | null;
  refLow: number | null;
  refHigh: number | null;
}

export interface RailGeometry {
  /** 0~1 비율 (막대 폭 기준) */
  valueX: number;
  previousX: number | null;
  /** 기준범위 띠 [시작, 끝] — 하한 없음은 0, 상한 없음은 1 */
  band: [number, number] | null;
  showLowEdge: boolean;
  showHighEdge: boolean;
}

const RAIL_PAD = 0.18;

/**
 * 하한 0 (`0-129`) 은 '하한 없음' 으로 그린다 — 0 까지 축을 늘리면 띠가 막대를 덮고 값 차이가 묻힌다 (디자인 노트).
 */
export function visualRange(refLow: number | null, refHigh: number | null): [number | null, number | null] {
  return [refLow === 0 ? null : refLow, refHigh];
}

export function railGeometry({ value, previous, refLow, refHigh }: RailInput): RailGeometry {
  const [low, high] = visualRange(refLow, refHigh);
  const pts = [value, previous, low, high].filter((v): v is number => v !== null);
  let min = Math.min(...pts);
  let max = Math.max(...pts);
  const span = max - min || Math.abs(max) || 1;
  min -= span * RAIL_PAD;
  max += span * RAIL_PAD;
  const x = (v: number) => (v - min) / (max - min);
  const hasRange = low !== null || high !== null;
  return {
    valueX: x(value),
    previousX: previous === null ? null : x(previous),
    band: hasRange ? [low === null ? 0 : x(low), high === null ? 1 : x(high)] : null,
    showLowEdge: low !== null,
    showHighEdge: high !== null,
  };
}

/* ── 추적검사 ───────────────────────────────────────── */

export type FollowUpStatus = "overdue" | "soon" | "later";

const SOON_DAYS = 60;
const DAY_MS = 86_400_000;

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 남은 기간 문구 · 상태 (KST 날짜 문자열끼리 — 시각 무관) */
export function followUpTiming(dueYmd: string, todayYmd: string): { status: FollowUpStatus; text: string } {
  const days = Math.round((ymdToUtc(dueYmd) - ymdToUtc(todayYmd)) / DAY_MS);
  if (days < 0) return { status: "overdue", text: `${-days}일 지남` };
  if (days === 0) return { status: "soon", text: "오늘" };
  if (days <= SOON_DAYS) return { status: "soon", text: `${days}일 남음` };
  return { status: "later", text: `${Math.round(days / 30)}개월 남음` };
}
