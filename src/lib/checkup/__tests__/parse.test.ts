// #527: 결과지 원문 해석 — 기준범위 네 형태 (스펙 §2-4) · 결과값 형태 (§2-3). 값은 가상.
import { describe, expect, it } from "vitest";
import { parseReference, parseResultValue } from "../parse";

describe("parseReference", () => {
  it("하한-상한 · 물결 · 공백", () => {
    expect(parseReference("10.0-20.0")).toMatchObject({ refText: "10.0-20.0", refLow: 10, refHigh: 20 });
    expect(parseReference("0.100 - 1.000")).toMatchObject({ refText: "0.100 - 1.000", refLow: 0.1, refHigh: 1 });
    expect(parseReference("3~7")).toMatchObject({ refLow: 3, refHigh: 7 });
  });

  it("0-상한은 하한 0 그대로 저장 (표시 규칙은 화면 몫)", () => {
    expect(parseReference("0-40")).toMatchObject({ refLow: 0, refHigh: 40 });
  });

  it("상한만 · 하한만", () => {
    expect(parseReference("<5.0")).toMatchObject({ refLow: null, refHigh: 5 });
    expect(parseReference("≤ 90")).toMatchObject({ refLow: null, refHigh: 90 });
    expect(parseReference("90 이하")).toMatchObject({ refLow: null, refHigh: 90 });
    expect(parseReference("≥60")).toMatchObject({ refLow: 60, refHigh: null });
    expect(parseReference("40 이상")).toMatchObject({ refLow: 40, refHigh: null });
    expect(parseReference("40-")).toMatchObject({ refLow: 40, refHigh: null });
  });

  it("정성 정상값은 원문만", () => {
    for (const t of ["-,음성", "+-,약양성", "정상, (정상)", "정상", "-"]) {
      expect(parseReference(t)).toMatchObject({ refText: t, refLow: null, refHigh: null });
    }
  });

  it("빈칸 · 공백 · null 은 기준범위 없음", () => {
    expect(parseReference("")).toMatchObject({ refText: null, refLow: null, refHigh: null });
    expect(parseReference("   ")).toMatchObject({ refText: null, refLow: null, refHigh: null });
    expect(parseReference(null)).toMatchObject({ refText: null, refLow: null, refHigh: null });
  });

  it("뒤집힌 범위 · 깨진 입력은 해석하지 않고 원문 보존", () => {
    expect(parseReference("20-10")).toMatchObject({ refText: "20-10", refLow: null, refHigh: null });
    expect(parseReference("10-20-30")).toMatchObject({ refText: "10-20-30", refLow: null, refHigh: null });
    expect(parseReference("abc")).toMatchObject({ refText: "abc", refLow: null, refHigh: null });
  });
});

describe("parseReference — 미포함 경계 · 표기 정규화", () => {
  // 회귀: #527 사전 리뷰 major 2 (`<b` · `미만` 은 상한 미포함)
  it("`<` · `미만` 은 상한 미포함, `≤` · `<=` · `이하` 는 포함", () => {
    expect(parseReference("<5.7")).toMatchObject({ refHigh: 5.7, highExclusive: true });
    expect(parseReference("5.7 미만")).toMatchObject({ refHigh: 5.7, highExclusive: true });
    expect(parseReference("<=5.7")).toMatchObject({ refHigh: 5.7, highExclusive: false });
    expect(parseReference("≤5.7")).toMatchObject({ refHigh: 5.7, highExclusive: false });
    expect(parseReference("5.7 이하")).toMatchObject({ refHigh: 5.7, highExclusive: false });
  });

  it("`>` · `초과` 는 하한 미포함, `≥` · `이상` · `a-` 는 포함", () => {
    expect(parseReference(">60")).toMatchObject({ refLow: 60, lowExclusive: true });
    expect(parseReference("60 초과")).toMatchObject({ refLow: 60, lowExclusive: true });
    expect(parseReference(">=60")).toMatchObject({ refLow: 60, lowExclusive: false });
    expect(parseReference("60 이상")).toMatchObject({ refLow: 60, lowExclusive: false });
    expect(parseReference("60-")).toMatchObject({ refLow: 60, lowExclusive: false });
    expect(parseReference("10-20")).toMatchObject({ lowExclusive: false, highExclusive: false });
  });

  it("전각 · en dash · 천단위 쉼표는 해석하되 refText 는 원문", () => {
    expect(parseReference("＜5")).toMatchObject({ refText: "＜5", refHigh: 5, highExclusive: true });
    expect(parseReference("10.0–20.0")).toMatchObject({ refText: "10.0–20.0", refLow: 10, refHigh: 20 });
    expect(parseReference("1,000-2,000")).toMatchObject({ refLow: 1000, refHigh: 2000 });
  });
});

describe("parseResultValue", () => {
  it("numeric 항목의 순수 숫자 → valueNum + 원문 보존", () => {
    expect(parseResultValue("12.30", "numeric")).toEqual({ valueNum: 12.3, valueText: "12.30" });
    expect(parseResultValue(" 7 ", "numeric")).toEqual({ valueNum: 7, valueText: "7" });
  });

  it("범위 문자열 · 부등호 값 · 정성 값은 원문만", () => {
    expect(parseResultValue("0-2", "numeric")).toEqual({ valueNum: null, valueText: "0-2" });
    expect(parseResultValue("<0.5", "numeric")).toEqual({ valueNum: null, valueText: "<0.5" });
    expect(parseResultValue("결과지 참조", "numeric")).toEqual({ valueNum: null, valueText: "결과지 참조" });
  });

  it("qualitative · text 항목은 숫자여도 원문만", () => {
    expect(parseResultValue("정상", "qualitative")).toEqual({ valueNum: null, valueText: "정상" });
    expect(parseResultValue("+-", "qualitative")).toEqual({ valueNum: null, valueText: "+-" });
    expect(parseResultValue("3", "text")).toEqual({ valueNum: null, valueText: "3" });
  });

  it("빈 값은 둘 다 null", () => {
    expect(parseResultValue("  ", "numeric")).toEqual({ valueNum: null, valueText: null });
    expect(parseResultValue(undefined, "numeric")).toEqual({ valueNum: null, valueText: null });
  });
});
