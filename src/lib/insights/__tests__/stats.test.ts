// #397: 통계 유틸.
import { describe, expect, it } from "vitest";
import { correlationWord, mean, median, pearson } from "../stats";

describe("median · mean", () => {
  it("홀수 · 짝수 · 빈 배열", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(mean([1, 2, 6])).toBe(3);
    expect(mean([])).toBeNull();
  });
});

describe("pearson", () => {
  it("완전 상관 1 · 역상관 −1 · n < 3 · 분산 0 → null", () => {
    expect(pearson([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }])).toBeCloseTo(1, 10);
    expect(pearson([{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 2 }])).toBeCloseTo(-1, 10);
    expect(pearson([{ x: 1, y: 2 }, { x: 2, y: 4 }])).toBeNull();
    expect(pearson([{ x: 1, y: 2 }, { x: 1, y: 4 }, { x: 1, y: 6 }])).toBeNull();
  });

  it("무상관은 0 근처", () => {
    const r = pearson([{ x: 1, y: 1 }, { x: 2, y: -1 }, { x: 3, y: -1 }, { x: 4, y: 1 }]);
    expect(Math.abs(r as number)).toBeLessThan(1e-9);
  });

  it("문구 경계 0.1 · 0.3", () => {
    expect(correlationWord(0.05)).toBe("관계 없음");
    expect(correlationWord(-0.1)).toBe("약한 관계");
    expect(correlationWord(0.3)).toBe("관계 있음");
    expect(correlationWord(null)).toBeNull();
  });
});
