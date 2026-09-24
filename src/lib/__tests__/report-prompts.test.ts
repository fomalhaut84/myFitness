// #444 F8: 리포트 프롬프트가 요구 도구를 이름으로 명시하는지 (#203 — 자연어만 두면 Sonnet 이 호출을 건너뛴다).
import { describe, expect, it } from "vitest";
import { EVENING_PROMPT, MORNING_PROMPT, WEEKLY_BASELINE_DAYS, WEEKLY_CURRENT_DAYS, buildWeeklyReportPrompt, weeklyBaselineEndDate } from "../report-prompts";

describe("MORNING_PROMPT", () => {
  it("혈압 7일 · 오늘의 운동 추천 도구를 명시한다 (A3 · A4)", () => {
    expect(MORNING_PROMPT).toContain("get_blood_pressure(days=7)");
    expect(MORNING_PROMPT).toContain("recommend_today_workout");
  });
});

describe("EVENING_PROMPT", () => {
  it("오늘 러닝마다 get_activity_context 를 호출하게 한다 (A6 · A11)", () => {
    expect(EVENING_PROMPT).toContain("get_activity_context(activityId)");
    expect(EVENING_PROMPT).toMatch(/기상|환경/);
  });
  it("#455 A5: 오늘 러닝이 신기록인지 get_personal_records 로 본다", () => {
    expect(EVENING_PROMPT).toContain("get_personal_records()");
    expect(EVENING_PROMPT).toMatch(/신기록/);
  });
});

describe("buildWeeklyReportPrompt", () => {
  const prompt = buildWeeklyReportPrompt("2026-09-17");

  it("이번 주 (days=6) 와 직전 4주 (days=27 · endDate=오늘−7일) 두 창을 명시한다 — PR #453 Codex P2", () => {
    expect(WEEKLY_CURRENT_DAYS).toBe(6);
    expect(WEEKLY_BASELINE_DAYS).toBe(27);
    expect(prompt).toContain('get_activities(days=6, type="running")');
    expect(prompt).toContain('get_activities(days=27, endDate="2026-09-17", type="running")');
  });

  it("VO2max/LT 추세 · 활성 플랜 도구를 추가한다 (A7)", () => {
    expect(prompt).toContain('get_fitness_metric_trend(days=13, granularity="daily")');
    expect(prompt).toContain("get_active_training_plan()");
    expect(prompt).toContain("get_blood_pressure(days=7)");
  });

  it("항목에 80/20 · HRR 중앙값 · VO2max/LT · 플랜 준수율이 있다", () => {
    expect(prompt).toContain("easyPct");
    expect(prompt).toMatch(/80\/20/);
    expect(prompt).toMatch(/HRR/);
    expect(prompt).toMatch(/VO2max/);
    expect(prompt).toMatch(/준수율/);
  });

  it("#455: 신기록 · 체지방/근육량 · 강도 분 · 수면 규칙성 · 다이나믹스 도구와 항목", () => {
    expect(prompt).toContain("get_personal_records()");
    expect(prompt).toContain("get_body_composition(days=27)");
    // 회귀: PR #462 Codex P1 — 150분 비교는 가중 합으로
    expect(prompt).toContain("totals.weightedIntensityMinTotal");
    expect(prompt).toMatch(/150분/);
    expect(prompt).toContain("regularity");
    expect(prompt).toContain("runningSummary.dynamics");
    expect(prompt).toMatch(/신기록/);
  });

  it("weeklyBaselineEndDate 는 오늘(KST) − 7일", () => {
    expect(weeklyBaselineEndDate(new Date("2026-09-24T00:30:00+09:00"))).toBe("2026-09-17");
    // KST 자정 직전 — UTC 로는 전날이지만 KST 날짜 기준
    expect(weeklyBaselineEndDate(new Date("2026-09-24T23:59:00+09:00"))).toBe("2026-09-17");
    expect(weeklyBaselineEndDate(new Date("2026-01-03T09:00:00+09:00"))).toBe("2025-12-27");
  });
});
