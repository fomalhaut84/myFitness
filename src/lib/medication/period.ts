// #544: 복용 기간 계산 — N일분 → 종료일 · 상태 · 표기. KST 날짜 문자열끼리 (시각 무관). 순수.
import { addDaysYmd, diffDaysYmd } from "@/lib/history/buckets";
import type { MedicationDto } from "./dto";

export const MAX_COURSE_DAYS = 365;

/** "N일분" → 종료일 (시작일 포함 N일 · 1일분 = 시작일). 범위 밖이면 null */
export function endFromDays(startYmd: string, days: number): string | null {
  if (!Number.isInteger(days) || days < 1 || days > MAX_COURSE_DAYS) return null;
  return addDaysYmd(startYmd, days - 1);
}

/** 시작 · 종료 포함 일수 */
export function courseDays(startYmd: string, endYmd: string): number {
  return diffDaysYmd(startYmd, endYmd) + 1;
}

export type MedicationStatus = "active" | "ended" | "scheduled";

export function medicationStatus(med: Pick<MedicationDto, "startDate" | "endDate">, todayYmd: string): MedicationStatus {
  if (med.startDate > todayYmd) return "scheduled";
  if (med.endDate !== null && med.endDate < todayYmd) return "ended";
  return "active";
}

export type EndDecision = "end" | "already_ended" | "not_started";

/**
 * 복용 종료 (오늘) 판정 — 화면의 "복용 중" (`medicationStatus` active · 종료일 = 오늘 포함) 과 맞춘다.
 * 종료일이 오늘이면 같은 값을 다시 쓰는 것이라 종료로 본다 (PR 전 리뷰 major — 카드가 버튼을 보이는데 409 였다).
 */
export function endTodayDecision(med: Pick<MedicationDto, "startDate" | "endDate">, todayYmd: string): EndDecision {
  if (med.startDate > todayYmd) return "not_started";
  if (med.endDate !== null && med.endDate < todayYmd) return "already_ended";
  return "end";
}

/** "N년 N개월째" · "N개월째" · "N일째" (시작일 = 1일째) */
export function sinceText(startYmd: string, todayYmd: string): string {
  const days = diffDaysYmd(startYmd, todayYmd) + 1;
  if (days < 31) return `${days}일째`;
  const [sy, sm, sd] = startYmd.split("-").map(Number);
  const [ty, tm, td] = todayYmd.split("-").map(Number);
  const months = (ty - sy) * 12 + (tm - sm) - (td < sd ? 1 : 0);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${Math.max(1, rest)}개월째`;
  return rest === 0 ? `${years}년째` : `${years}년 ${rest}개월째`;
}

/** 진행 중 단기 복용의 남은 날 (오늘 포함하지 않음 · 종료일 = 오늘이면 0) */
export function daysLeft(endYmd: string, todayYmd: string): number {
  return diffDaysYmd(todayYmd, endYmd);
}
