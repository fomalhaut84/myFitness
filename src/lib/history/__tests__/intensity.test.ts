// #394 (M15-2): 셀 색 강도 스케일.
import { describe, expect, it } from "vitest";
import { buildIntensityScale } from "../intensity";

describe("buildIntensityScale", () => {
  it("합계형은 0 기준 5단계", () => {
    const scale = buildIntensityScale([5, 10, 20], true);
    expect(scale(20)).toBe(5);
    expect(scale(10)).toBe(3);
    expect(scale(1)).toBe(1);
  });

  it("평균형은 min~max 정규화 — 좁은 범위(체중)도 단계가 갈린다", () => {
    const scale = buildIntensityScale([71, 72, 73], false);
    expect(scale(71)).toBe(1);
    expect(scale(72)).toBe(3);
    expect(scale(73)).toBe(5);
  });

  it("값이 하나뿐이거나 전부 같으면 중간 단계, 빈 입력은 1", () => {
    expect(buildIntensityScale([72], false)(72)).toBe(3);
    expect(buildIntensityScale([], true)(3)).toBe(1);
  });

  it("범위 밖 값은 1~5 로 클램프", () => {
    const scale = buildIntensityScale([10, 20], false);
    expect(scale(5)).toBe(1);
    expect(scale(99)).toBe(5);
  });
});
