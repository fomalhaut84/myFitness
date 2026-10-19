// #552 R3 · R4: 코드 기본값은 모두 검증을 통과하고, 기능이 깨지는 수정 (필수 도구 문구 · 변수) 은 저장 전에 막힌다.
import { describe, expect, it } from "vitest";
import { PROMPT_DEFINITIONS, PROMPT_KEYS, PROMPT_MAX_LENGTH } from "../definitions";
import { validatePrompt } from "../validate";

describe("코드 기본값", () => {
  it.each(PROMPT_KEYS)("%s 기본값은 오류 · 경고가 없다", (key) => {
    expect(validatePrompt(key, PROMPT_DEFINITIONS[key].defaultBody)).toEqual({ errors: [], warnings: [] });
  });
});

describe("validatePrompt", () => {
  const weekly = PROMPT_DEFINITIONS.weekly_report.defaultBody;

  it("빈 본문은 오류 하나", () => {
    expect(validatePrompt("system", "  \n ").errors).toEqual([{ message: "본문이 비어 있습니다" }]);
  });

  it("길이 상한을 넘으면 오류", () => {
    const { errors } = validatePrompt("system", "가".repeat(PROMPT_MAX_LENGTH + 1));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/너무 깁니다/);
  });

  it("모르는 변수는 행 번호와 함께 오류", () => {
    const { errors } = validatePrompt("weekly_report", `${weekly}\n다음 주는 {{nextWeekGoal}} 기준으로`);
    expect(errors).toEqual([
      expect.objectContaining({ message: expect.stringContaining("{{nextWeekGoal}}"), line: weekly.split("\n").length + 1 }),
    ]);
  });

  it("변수를 쓰지 않는 프롬프트에 변수가 있으면 오류", () => {
    const { errors } = validatePrompt("system", "안녕 {{name}}");
    expect(errors[0].message).toMatch(/변수를 쓰지 않습니다/);
  });

  it("필수 변수가 빠지면 오류 — {{baselineEndDate}} 를 날짜로 박으면 다음 주부터 틀린 창이 된다", () => {
    const hardcoded = weekly.replaceAll("{{baselineEndDate}}", "2026-09-17");
    const messages = validatePrompt("weekly_report", hardcoded).errors.map((e) => e.message);
    expect(messages).toContain("필수 변수 {{baselineEndDate}} 가 없습니다");
  });

  it("필수 도구 문구가 빠지면 오류 (#203 — 이름이 없으면 Sonnet 이 도구를 건너뛴다)", () => {
    const body = PROMPT_DEFINITIONS.morning_report.defaultBody.replace("recommend_today_workout", "오늘 운동 추천 도구");
    expect(validatePrompt("morning_report", body).errors).toEqual([{ message: "필수 문구가 없습니다: recommend_today_workout" }]);
  });

  it("회귀: PR #462 Codex P1 — 강도 분 150분 비교를 단순합으로 바꾸면 오류", () => {
    const body = weekly.replace("totals.weightedIntensityMinTotal", "totals.intensityMinTotal(가중)");
    expect(validatePrompt("weekly_report", body).errors.map((e) => e.message)).toContain("필수 문구가 없습니다: totals.weightedIntensityMinTotal");
  });

  it("어드바이저 allowlist 밖 도구는 경고 (저장은 가능)", () => {
    const result = validatePrompt("system", "첫 줄\n- mcp__myfitness__get_weekly_summary() 로 요약");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{ message: expect.stringContaining("get_weekly_summary"), line: 2 }]);
  });

  it("단일 중괄호 JSON 예시는 변수로 보지 않는다", () => {
    expect(validatePrompt("system", '응답 예: {"score": 80}').errors).toEqual([]);
  });
});
