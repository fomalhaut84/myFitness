// #527 (2/2): 화면 계산 — 범위 막대 (하한 0 = 하한 없음) · 표기 · 직전 대비 · 추적검사 · 폼 변환. 값은 가상.
import { describe, expect, it } from "vitest";
import { followUpTiming, formatDelta, formatResultValue, railGeometry, splitTrendByUnit, visualRange } from "../view";
import { emptyFormState, formStateFromDetail, formStateToInput, groupRowsByCategory, newCustomRow } from "../form-model";
import { CHECKUP_INPUT } from "../schema";
import type { CheckupDetailDto, CheckupResultDto } from "../dto";

describe("railGeometry", () => {
  it("하한 0 은 하한 없음 — 띠가 0 에서 시작, 왼쪽 경계선 없음", () => {
    expect(visualRange(0, 129)).toEqual([null, 129]);
    const g = railGeometry({ value: 128, previous: 135, refLow: 0, refHigh: 129 });
    expect(g.band?.[0]).toBe(0);
    expect(g.showLowEdge).toBe(false);
    expect(g.showHighEdge).toBe(true);
    // 값 차이가 막대에서 보인다 (0 까지 늘렸다면 두 점이 거의 겹친다)
    expect((g.previousX ?? 0) - g.valueX).toBeGreaterThan(0.3);
  });

  it("모든 좌표는 0~1 · 범위 밖 값은 띠 밖", () => {
    const g = railGeometry({ value: 214, previous: 205, refLow: null, refHigh: 199 });
    for (const v of [g.valueX, g.previousX!, ...g.band!]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(g.valueX).toBeGreaterThan(g.band![1]);
  });

  it("범위 없음 · 직전 없음 · 같은 값", () => {
    const g = railGeometry({ value: 5, previous: null, refLow: null, refHigh: null });
    expect(g.band).toBeNull();
    expect(g.previousX).toBeNull();
    expect(Number.isFinite(g.valueX)).toBe(true);
    expect(Number.isFinite(railGeometry({ value: 0, previous: 0, refLow: null, refHigh: null }).valueX)).toBe(true);
  });
});

describe("표기", () => {
  it("카탈로그 자릿수 · 카탈로그 밖은 원문 자릿수 · 정성은 원문", () => {
    expect(formatResultValue({ itemCode: "creatinine", valueNum: 1, valueText: "1" })).toBe("1.00");
    expect(formatResultValue({ itemCode: "custom:x", valueNum: 1.5, valueText: "1.50" })).toBe("1.50");
    expect(formatResultValue({ itemCode: "abdominal_us", valueNum: null, valueText: "유소견" })).toBe("유소견");
  });

  it("직전 대비 — 부호 · ±0 · 단위가 다르거나 수치가 아니면 null", () => {
    const cur = { valueNum: 128, valueText: "128", unit: "mg/dL" };
    expect(formatDelta("ldl", cur, { valueNum: 135, unit: "mg/dL" })).toBe("−7");
    expect(formatDelta("ldl", cur, { valueNum: 119, unit: "mg/dL" })).toBe("+9");
    expect(formatDelta("ldl", cur, { valueNum: 128, unit: "mg/dL" })).toBe("±0");
    expect(formatDelta("creatinine", { valueNum: 0.98, valueText: "0.98", unit: "mg/dL" }, { valueNum: 0.95, unit: "mg/dL" })).toBe("+0.03");
    expect(formatDelta("egfr", { valueNum: 91, valueText: "91", unit: "mL/min/1.73m²" }, { valueNum: 93, unit: "mL/min" })).toBeNull();
    expect(formatDelta("ldl", cur, null)).toBeNull();
  });
});

describe("followUpTiming", () => {
  it("지남 · 오늘 · 60일 이내 · 그 이후", () => {
    expect(followUpTiming("2025-09-30", "2025-10-16")).toEqual({ status: "overdue", text: "16일 지남" });
    expect(followUpTiming("2025-10-16", "2025-10-16")).toEqual({ status: "soon", text: "오늘" });
    expect(followUpTiming("2025-12-15", "2025-10-16")).toEqual({ status: "soon", text: "60일 남음" });
    expect(followUpTiming("2026-06-11", "2025-10-16")).toEqual({ status: "later", text: "8개월 남음" });
  });
});

function result(over: Partial<CheckupResultDto>): CheckupResultDto {
  return {
    id: "r",
    itemCode: "ldl",
    label: "LDL",
    category: "지질",
    valueNum: 120,
    valueText: "120",
    unit: "mg/dL",
    refText: "0-129",
    refLow: 0,
    refHigh: 129,
    flag: "normal",
    flagSource: "computed",
    note: null,
    followUp: null,
    followUpDue: null,
    previous: null,
    ...over,
  };
}

describe("폼 변환", () => {
  it("빈 폼 → 결과 없음 → 스키마가 거부 (최소 1개)", () => {
    const input = formStateToInput(emptyFormState("2025-10-16"));
    expect(input.results).toEqual([]);
    expect(CHECKUP_INPUT.safeParse(input).success).toBe(false);
  });

  it("상세 → 폼 → 입력 왕복: 원문 항목명 · 기관 판정 보존, 계산 판정은 '자동', 카탈로그 단위는 비움", () => {
    const detail: CheckupDetailDto = {
      id: "c",
      date: "2025-06-11",
      institution: "가상의원",
      kind: "comprehensive",
      resultCount: 3,
      counts: { caution: 1, abnormal: 0 },
      summary: null,
      findings: [
        { category: "흉부", text: "가상 소견" },
        { category: "지질", text: "가상 소견 2", flag: "bogus" },
      ],
      source: "pdf",
      results: [
        result({ label: "LDL 콜레스테롤[계산]" }),
        result({ id: "r2", itemCode: "tg", label: "중성지방", valueNum: 171, valueText: "171", flag: "caution", flagSource: "institution" }),
        result({ id: "r3", itemCode: "custom:가상", label: "가상 항목", category: "종양표지자", valueNum: 1.2, valueText: "1.2", unit: "ng/mL", refText: null, refLow: null, refHigh: null, flag: null, flagSource: null }),
      ],
    };
    const state = formStateFromDetail(detail);
    const ldl = state.rows.find((r) => r.itemCode === "ldl")!;
    expect(ldl).toMatchObject({ label: "LDL 콜레스테롤[계산]", value: "120", flag: "", unit: "" });
    expect(state.rows.find((r) => r.itemCode === "tg")?.flag).toBe("caution");
    const custom = state.rows.find((r) => r.custom)!;
    expect(custom).toMatchObject({ itemCode: "custom:가상", category: "종양표지자", unit: "ng/mL" });

    const input = formStateToInput(state);
    expect(CHECKUP_INPUT.safeParse(input).success).toBe(true);
    // 회귀: #527 2/2 사전 리뷰 critical — 폼이 편집하지 않는 findings · source 가 수정 저장으로 지워지거나 바뀌지 않는다
    expect(input.source).toBe("pdf");
    expect(input.findings).toEqual([
      { category: "흉부", text: "가상 소견", flag: null },
      { category: "지질", text: "가상 소견 2", flag: null },
    ]);
    expect(input.results).toHaveLength(3);
    expect(input.results.find((r) => r.itemCode === "custom:가상")).toMatchObject({ category: "종양표지자", unit: "ng/mL" });
    expect(input.results.find((r) => r.itemCode === "ldl")).toMatchObject({ unit: null, flag: null, ref: "0-129" });
  });

  it("직접 추가 행은 itemCode 없이 label 로 — 섹션은 카탈로그 순서, 새 분류는 기타 앞", () => {
    const state = emptyFormState("2025-10-16");
    const rows = [...state.rows, { ...newCustomRow("n1", "가상분류"), label: "가상", value: "1" }, newCustomRow("n2")];
    const groups = groupRowsByCategory(rows).map((g) => g.category);
    expect(groups[0]).toBe("신체계측");
    expect(groups.slice(-2)).toEqual(["가상분류", "기타"]);
    const input = formStateToInput({ ...state, rows });
    expect(input.results).toEqual([expect.not.objectContaining({ itemCode: expect.anything() })]);
    expect(input.results[0]).toMatchObject({ label: "가상", category: "가상분류", value: "1" });
  });
});

// 회귀: #531 (PR #530 Codex P2) — 단위가 다른 회차를 같은 선 · 같은 축에 그리지 않는다
describe("splitTrendByUnit", () => {
  const p = (valueNum: number | null, unit: string | null, valueText: string | null = null) => ({ valueNum, unit, valueText });

  it("최근 수치 회차와 단위가 다른 점은 빼고 개수를 센다", () => {
    const { plotted, excluded } = splitTrendByUnit([p(5.1, "mmol/L"), p(98, "mg/dL"), p(101, "mg/dL")]);
    expect(plotted.map((x) => x.valueNum)).toEqual([98, 101]);
    expect(excluded).toBe(1);
  });

  it("기준 단위는 마지막 수치 회차 — 뒤의 정성 결과는 기준이 아니다", () => {
    const { plotted, excluded } = splitTrendByUnit([p(5.1, "mmol/L"), p(98, "mg/dL"), p(null, null, "결과지 참조")]);
    expect(plotted.map((x) => x.valueNum)).toEqual([98]);
    expect(excluded).toBe(1);
  });

  it("단위 없음 (null) 끼리는 같은 단위 · 정성만 있으면 빈 결과", () => {
    expect(splitTrendByUnit([p(1, null), p(2, null)]).excluded).toBe(0);
    expect(splitTrendByUnit([p(null, null, "음성")])).toEqual({ plotted: [], excluded: 0 });
  });
});
