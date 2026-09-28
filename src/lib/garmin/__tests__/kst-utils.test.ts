// #365: 취침 · 기상 시각을 KST 소수 시간으로 (서버 TZ 무관)
import { describe, expect, it } from "vitest";
import { hourOfDayKST } from "../utils";

describe("hourOfDayKST", () => {
  it("KST 23:30 → 23.5 · KST 06:15 → 6.25 · 자정 → 0", () => {
    expect(hourOfDayKST(new Date("2026-04-05T23:30:00+09:00"))).toBeCloseTo(23.5);
    expect(hourOfDayKST(new Date("2026-04-06T06:15:00+09:00"))).toBeCloseTo(6.25);
    expect(hourOfDayKST(new Date("2026-04-06T00:00:00+09:00"))).toBe(0);
  });
});
