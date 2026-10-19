// #552 M19-3 G1 · G2: 개선안 응답 파싱 (JSON · 코드펜스 · 깨진 응답) · 검증 실패 제안은 저장 불가 · 지시문 조립
import { describe, expect, it } from "vitest";
import { PROMPT_DEFINITIONS } from "../definitions";
import {
  SUGGEST_RATIONALE_MAX,
  SUGGEST_RESULT_MAX_LENGTH,
  buildSuggestPrompt,
  evaluateSuggestion,
  parseSuggestion,
  readStoredSuggestion,
  suggestionNote,
} from "../suggest-prompt";

describe("parseSuggestion", () => {
  it("순수 JSON", () => {
    expect(parseSuggestion('{"body":"새 본문","rationale":["짧게"]}')).toEqual({ body: "새 본문", rationale: ["짧게"] });
  });

  it("코드펜스 · 앞뒤 설명이 붙은 JSON", () => {
    expect(parseSuggestion('```json\n{"body":"A","rationale":[]}\n```')).toEqual({ body: "A", rationale: [] });
    expect(parseSuggestion('개선안입니다:\n{"body":"B","rationale":["x"]}\n끝')).toEqual({ body: "B", rationale: ["x"] });
  });

  it("본문 JSON 예시의 중괄호가 있어도 바깥 객체를 읽는다", () => {
    const raw = JSON.stringify({ body: '응답 형식: {"a": 1}', rationale: ["형식 명시"] });
    expect(parseSuggestion(raw)?.body).toBe('응답 형식: {"a": 1}');
  });

  it("깨진 응답 · 객체 아님 · 본문 없음은 null", () => {
    expect(parseSuggestion("")).toBeNull();
    expect(parseSuggestion("죄송합니다, 개선할 수 없습니다")).toBeNull();
    expect(parseSuggestion('{"body": "끊김')).toBeNull();
    expect(parseSuggestion("null")).toBeNull();
    expect(parseSuggestion('["a"]')).toBeNull();
    expect(parseSuggestion('{"body":"   ","rationale":[]}')).toBeNull();
    expect(parseSuggestion('{"body":123}')).toBeNull();
  });

  it("근거는 문자열만 · 빈 값 제거 · 상한", () => {
    const many = Array.from({ length: SUGGEST_RATIONALE_MAX + 3 }, (_, i) => `이유 ${i}`);
    const parsed = parseSuggestion(JSON.stringify({ body: "본문", rationale: [" a ", "", 3, null, ...many] }));
    expect(parsed?.rationale[0]).toBe("a");
    expect(parsed?.rationale).toHaveLength(SUGGEST_RATIONALE_MAX);
    expect(parseSuggestion('{"body":"본문","rationale":"한 줄"}')?.rationale).toEqual([]);
  });
});

describe("evaluateSuggestion", () => {
  it("필수 문구를 뺀 제안은 검증 오류 — 초안 저장 불가", () => {
    const body = PROMPT_DEFINITIONS.morning_report.defaultBody.replaceAll("recommend_today_workout", "추천");
    const result = evaluateSuggestion("morning_report", { body, rationale: [] });
    expect(result.validation.errors.length).toBeGreaterThan(0);
  });

  it("기본값 그대로면 오류 없음", () => {
    const result = evaluateSuggestion("evening_report", { body: PROMPT_DEFINITIONS.evening_report.defaultBody, rationale: ["그대로"] });
    expect(result.validation.errors).toEqual([]);
    expect(result.rationale).toEqual(["그대로"]);
  });

  it("저장된 JSON 복원 · 깨졌으면 null", () => {
    expect(readStoredSuggestion("system", JSON.stringify({ body: "시스템", rationale: [] }))?.body).toBe("시스템");
    expect(readStoredSuggestion("system", "{broken")).toBeNull();
    expect(readStoredSuggestion("system", null)).toBeNull();
  });
});

describe("buildSuggestPrompt", () => {
  it("필수 변수 · 필수 문구 · 현재 본문을 담는다", () => {
    const prompt = buildSuggestPrompt("weekly_report", "현재 본문 XYZ", []);
    expect(prompt).toContain("{{baselineEndDate}}");
    expect(prompt).toContain("totals.weightedIntensityMinTotal");
    expect(prompt).toContain("현재 본문 XYZ");
    expect(prompt).toContain("아직 이 프롬프트로 만든 결과가 없습니다");
  });

  it("변수 없는 키는 새 변수를 만들지 말라고 한다", () => {
    expect(buildSuggestPrompt("system", "본문", [])).toContain("새 {{변수}} 를 만들지 마세요");
  });

  it("결과는 건당 상한으로 자른다", () => {
    const long = "가".repeat(SUGGEST_RESULT_MAX_LENGTH + 500);
    const prompt = buildSuggestPrompt("morning_report", "본문", [{ label: "10-18 모닝 리포트", response: long }]);
    expect(prompt).toContain("결과 1 — 10-18 모닝 리포트");
    expect(prompt).toContain("…(이하 생략)");
    expect(prompt).not.toContain("가".repeat(SUGGEST_RESULT_MAX_LENGTH + 1));
  });
});

describe("suggestionNote", () => {
  it("근거 요약 · 상한", () => {
    expect(suggestionNote(["짧게", "도구 명시"], 200)).toBe("AI 개선안: 짧게 / 도구 명시");
    expect(suggestionNote([], 200)).toBe("AI 개선안");
    const note = suggestionNote(["가".repeat(300)], 200);
    expect(note).toHaveLength(200);
    expect(note.endsWith("…")).toBe(true);
  });
});
