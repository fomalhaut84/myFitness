// #552 M19-2: 프롬프트 버전별 결과 조회 조건 · 비교 기본 선택
import { describe, expect, it } from "vitest";
import { buildResultsWhere, parseLimit, pickDefaultPair, resolveVersionFilter, RESULTS_DEFAULT_LIMIT, RESULTS_MAX_LIMIT } from "../results-query";

describe("resolveVersionFilter", () => {
  const keyIds = ["a", "b"];
  it("필터가 없으면 이 키의 모든 버전 + 버전 정보 없음", () => {
    expect(resolveVersionFilter([], keyIds)).toEqual({ versionIds: ["a", "b"], includeNone: true });
  });
  it("고른 버전만 · none 은 버전 정보 없음", () => {
    expect(resolveVersionFilter(["b", "none"], keyIds)).toEqual({ versionIds: ["b"], includeNone: true });
    expect(resolveVersionFilter(["a"], keyIds)).toEqual({ versionIds: ["a"], includeNone: false });
  });
  it("다른 키의 버전 id 는 버린다 (러닝 평가 · 기타 운동 평가는 카테고리가 같다)", () => {
    expect(resolveVersionFilter(["x", "a"], keyIds)).toEqual({ versionIds: ["a"], includeNone: false });
  });
});

describe("buildResultsWhere", () => {
  it("리포트 키는 그 카테고리 · promptVersionId", () => {
    expect(buildResultsWhere("weekly_report", { versionIds: ["a"], includeNone: true })).toEqual({
      category: { in: ["weekly_report"] },
      OR: [{ promptVersionId: { in: ["a"] } }, { promptVersionId: null }],
    });
  });
  it("시스템 프롬프트는 AI 아닌 기록을 뺀 전 카테고리 · systemPromptVersionId", () => {
    expect(buildResultsWhere("system", { versionIds: ["s"], includeNone: false })).toEqual({
      category: { notIn: ["auto_adjust_proposal"] },
      OR: [{ systemPromptVersionId: { in: ["s"] } }],
    });
  });
  it("운동 평가 두 키는 같은 카테고리", () => {
    expect(buildResultsWhere("activity_eval_brief", { versionIds: [], includeNone: true }).category).toEqual({ in: ["activity_eval"] });
  });
});

describe("parseLimit", () => {
  it("기본 · 상한 · 잘못된 값", () => {
    expect(parseLimit(null)).toBe(RESULTS_DEFAULT_LIMIT);
    expect(parseLimit("abc")).toBe(RESULTS_DEFAULT_LIMIT);
    expect(parseLimit("-3")).toBe(RESULTS_DEFAULT_LIMIT);
    expect(parseLimit("10")).toBe(10);
    expect(parseLimit("500")).toBe(RESULTS_MAX_LIMIT);
  });
});

describe("pickDefaultPair", () => {
  it("최신 + 다른 버전의 최신 (버전 정보 있는 쪽 우선)", () => {
    const rs = [
      { id: "r1", versionId: "v4" },
      { id: "r2", versionId: "v4" },
      { id: "r3", versionId: null },
      { id: "r4", versionId: "v3" },
    ];
    expect(pickDefaultPair(rs)).toEqual(["r1", "r4"]);
  });
  it("다른 버전이 버전 정보 없음뿐이면 그것", () => {
    expect(pickDefaultPair([{ id: "r1", versionId: "v1" }, { id: "r2", versionId: null }])).toEqual(["r1", "r2"]);
  });
  it("모두 같은 버전이면 바로 이전 결과 · 하나면 하나 · 없으면 빈 배열", () => {
    expect(pickDefaultPair([{ id: "r1", versionId: "v1" }, { id: "r2", versionId: "v1" }])).toEqual(["r1", "r2"]);
    expect(pickDefaultPair([{ id: "r1", versionId: "v1" }])).toEqual(["r1"]);
    expect(pickDefaultPair([])).toEqual([]);
  });
});
