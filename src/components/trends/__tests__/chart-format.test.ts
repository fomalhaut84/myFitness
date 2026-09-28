// #395 (M15-3): 축 · 툴팁 포맷터. Recharts 가 숫자가 아닌 값을 넘겨도 조용히 틀린 문자열을 만들지 않는다.
import { describe, expect, it } from "vitest";
import { aggregateCaption, formatAxisValue, formatChartValue } from "../chart-format";

const km = { format: "number", decimals: 2, unit: "km" } as const;
const pace = { format: "pace", decimals: 0, unit: "sec/km" } as const;

describe("formatAxisValue", () => {
  it("숫자 지표: 소수 최대 1자리 · 1만 이상은 k", () => {
    expect(formatAxisValue(km, 198.3333)).toBe("198.3");
    expect(formatAxisValue({ format: "number", decimals: 0 }, 72.5)).toBe("73");
    expect(formatAxisValue({ format: "number", decimals: 0 }, 250000)).toBe("250k");
  });

  it("pace 지표는 앱 페이스 표기", () => {
    expect(formatAxisValue(pace, 321)).toBe(`5'21"`);
  });

  it("숫자가 아니면 빈 문자열 (Date · 문자열 · NaN)", () => {
    expect(formatAxisValue(km, new Date())).toBe("");
    expect(formatAxisValue(km, "12")).toBe("");
    expect(formatAxisValue(km, Number.NaN)).toBe("");
  });
});

describe("formatChartValue", () => {
  it("정식 표기 + 화면 단위", () => {
    expect(formatChartValue(km, 1853.6)).toBe("1,853.60 km");
    expect(formatChartValue(pace, 321)).toBe(`5'21" /km`);
    expect(formatChartValue({ format: "number", decimals: 1, unit: "" }, 49.8)).toBe("49.8");
  });

  it("null · undefined 는 기록 없음", () => {
    expect(formatChartValue(km, null)).toBe("기록 없음");
    expect(formatChartValue(km, undefined)).toBe("기록 없음");
  });
});

describe("aggregateCaption", () => {
  it("집계 방식별 설명", () => {
    expect(aggregateCaption({ aggregate: "sum", withMinMax: false })).toContain("합계");
    expect(aggregateCaption({ aggregate: "avg", withMinMax: true })).toContain("띠");
    expect(aggregateCaption({ aggregate: "max", withMinMax: false })).toContain("최고");
    // #442: median
    expect(aggregateCaption({ aggregate: "median", withMinMax: true })).toBe("선 = 기간 중앙값, 띠 = 최저~최고");
    expect(aggregateCaption({ aggregate: "median", withMinMax: false })).toBe("선 = 기간 중앙값");
  });
});
