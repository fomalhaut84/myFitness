// #394 (M15-2): 일별 스트립 막대 높이.
import { describe, expect, it } from "vitest";
import { buildStripScale, STRIP_MIN_BAR_PERCENT } from "../strip-scale";

describe("buildStripScale", () => {
  it("합계형은 0 기준 비례", () => {
    const scale = buildStripScale([5, 10, 20], true);
    expect(scale(20)).toBe(100);
    expect(scale(10)).toBe(50);
  });

  it("평균형은 최솟값 조금 아래가 바닥 — 최솟값 막대도 최소 높이보다 크다", () => {
    const scale = buildStripScale([71, 72, 73], false);
    expect(scale(73)).toBe(100);
    expect(scale(71)).toBeGreaterThan(STRIP_MIN_BAR_PERCENT);
    expect(scale(72)).toBeGreaterThan(scale(71));
  });

  // 회귀: #394 사전 리뷰 major 2 — 전부 음수(감량 중 calorieBalance)일 때 `min * 0.97` 은 바닥을 최솟값 위로 올려
  // 좁은 범위에서 span < 0 → 모든 막대가 50% 로 평탄화됐다.
  it("전부 음수 · 좁은 범위에서도 비례가 유지된다", () => {
    const scale = buildStripScale([-800, -795, -790], false);
    expect(scale(-790)).toBe(100);
    expect(scale(-800)).toBeGreaterThan(STRIP_MIN_BAR_PERCENT);
    expect(scale(-800)).toBeLessThan(scale(-795));
    expect(scale(-795)).toBeLessThan(scale(-790));
  });

  it("값이 전부 같으면 중간 높이, 빈 입력은 0", () => {
    expect(buildStripScale([72, 72], false)(72)).toBe(50);
    expect(buildStripScale([], true)(1)).toBe(0);
  });
});
