// #444 F5~F8: 리포트 프롬프트 — 순수 (prisma · 싱크 없음). #552 부터 본문은 DB 활성 버전 (`resolvePrompt`) 이고
// 여기 상수는 코드 기본값 (`prompts/defaults/reports.ts`) 재노출 · 주간 변수 값 계산만 한다.
import { ymdKST } from "@/lib/garmin/utils";
import { EVENING_PROMPT_DEFAULT, MORNING_PROMPT_DEFAULT, WEEKLY_PROMPT_DEFAULT } from "@/lib/prompts/defaults/reports";
import { renderPrompt } from "@/lib/prompts/render";

export const MORNING_PROMPT = MORNING_PROMPT_DEFAULT;
export const EVENING_PROMPT = EVENING_PROMPT_DEFAULT;

/** 이번 주 창 — 도구는 오늘 포함 (days+1) 일이라 7일은 days=6 */
export const WEEKLY_CURRENT_DAYS = 6;
/** 직전 4주 창 폭 — endDate 와 함께 써서 이번 주를 제외 (PR #453 Codex P2) */
export const WEEKLY_BASELINE_DAYS = 27;
const BASELINE_OFFSET_DAYS = 7;
const DAY_MS = 86_400_000;

/** 직전 4주 창의 끝 = 오늘 (KST) − 7일. `get_activities(days=27, endDate=…)` 가 [오늘−34, 오늘−7] 을 본다 */
export function weeklyBaselineEndDate(now: Date = new Date()): string {
  return ymdKST(new Date(now.getTime() - BASELINE_OFFSET_DAYS * DAY_MS));
}

/**
 * 주간 리포트 프롬프트. `baselineEndDate` 는 `weeklyBaselineEndDate()` — 모델이 날짜 산술을 하지 않게 구체 날짜를 박는다.
 * `template` 은 DB 활성 본문 (#552) · 생략하면 코드 기본값.
 */
export function buildWeeklyReportPrompt(baselineEndDate: string, template: string = WEEKLY_PROMPT_DEFAULT): string {
  return renderPrompt(template, weeklyReportVars(baselineEndDate));
}

export function weeklyReportVars(baselineEndDate: string): Record<string, string> {
  return {
    currentDays: String(WEEKLY_CURRENT_DAYS),
    baselineDays: String(WEEKLY_BASELINE_DAYS),
    baselineEndDate,
  };
}
