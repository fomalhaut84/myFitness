// #547 (M18-4): 건강 기록 MCP 응답 조립 (순수). 약 이름 · 날짜는 전부 가상.
import { describe, expect, it } from "vitest";
import { flagText, medicationView, resolveItemQuery, resultValue, suggestItems } from "../health-records-view";
import type { MedicationDto } from "@/lib/medication/dto";

const TODAY = "2032-10-16";
const med = (over: Partial<MedicationDto>): MedicationDto => ({
  id: "m",
  name: "가상약",
  kind: "prescription",
  regimen: "long_term",
  ingredient: null,
  dose: "1정",
  frequency: null,
  startDate: "2029-04-02",
  endDate: null,
  purpose: null,
  prescriber: null,
  note: null,
  relatedItems: [],
  affectsHeartRate: false,
  ...over,
});

describe("flagText · resultValue", () => {
  it("기관 판정 · 범위 계산 · 정상 · 없음", () => {
    expect(flagText("caution", "institution")).toBe("주의 (기관 판정)");
    expect(flagText("abnormal", "computed")).toBe("이상 (범위 계산)");
    expect(flagText("normal", "computed")).toBe("정상 (범위 계산)");
    expect(flagText("normal", "institution")).toBe("정상 (기관 판정)");
    expect(flagText(null, null)).toBeNull();
  });
  it("원문 값 + 단위", () => {
    expect(resultValue({ valueText: "12.30", valueNum: 12.3, unit: "mg/dL" })).toBe("12.30 mg/dL");
    expect(resultValue({ valueText: null, valueNum: 5, unit: null })).toBe("5");
  });
});

describe("resolveItemQuery", () => {
  it("code · 이름 · 카탈로그 밖 이름 (custom) · 빈 값", () => {
    expect(resolveItemQuery("ldl")).toEqual({ code: "ldl" });
    expect(resolveItemQuery("LDL")).toEqual({ code: "ldl" });
    expect(resolveItemQuery("공복혈당")).toEqual({ code: "fbs" });
    expect(resolveItemQuery("custom:가상항목")).toEqual({ code: "custom:가상항목" });
    expect(resolveItemQuery("가상 검사")).toEqual({ code: "custom:가상검사" });
    expect(resolveItemQuery("custom:가상 항목")).toEqual({ code: "custom:가상항목" });
    expect(resolveItemQuery("  ")).toMatchObject({ error: expect.any(String) });
    expect(resolveItemQuery("※")).toMatchObject({ error: expect.any(String) });
  });
  // 회귀: #547 사전 리뷰 major — 카탈로그 밖 항목은 원문 전체가 code 라 일부 이름으로 못 찾았고 제안에도 없었다
  it("기록된 항목만 제안 · 카탈로그 밖 항목 포함 · 짧은 별칭 역매칭 없음", () => {
    const recorded = [
      { code: "tc", label: "총콜레스테롤" },
      { code: "ldl", label: "LDL 콜레스테롤" },
      { code: "custom:가상검사정량", label: "가상검사(정량)" },
      { code: "urine_ph", label: "요 pH" },
    ];
    expect(suggestItems("콜레스테롤", recorded)).toEqual(["총콜레스테롤 (tc)", "LDL 콜레스테롤 (ldl)"]);
    expect(suggestItems("가상검사", recorded)).toEqual(["가상검사(정량) (custom:가상검사정량)"]);
    expect(suggestItems("phosphorus", recorded)).toEqual([]);
  });
});

describe("medicationView", () => {
  it("복용 중 장기 — N개월째 · 관련 항목 이름 (카탈로그 · 기록된 다른 항목)", () => {
    const v = medicationView(med({ relatedItems: ["sbp", "custom:가상항목"] }), TODAY, { "custom:가상항목": "가상 항목" });
    expect(v).toMatchObject({ kind: "처방", regimen: "장기", status: "복용 중", relatedCheckupItems: ["수축기 혈압", "가상 항목"] });
    expect(v.period).toBe("2029-04-02 부터 복용 중 (3년 6개월째)");
  });
  it("끝난 단기 — 기간 · 일수", () => {
    const v = medicationView(med({ regimen: "short_term", startDate: "2031-05-20", endDate: "2031-05-26" }), TODAY, {});
    expect([v.status, v.period]).toEqual(["종료", "2031-05-20 ~ 2031-05-26 (7일)"]);
  });
});
