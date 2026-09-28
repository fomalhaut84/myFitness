// #405: 하한이 오늘보다 미래가 되는 원천 (미래 체중 기록) 을 원천에서 오늘로 클램프
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { MIN_HISTORY_YMD } from "@/lib/date";
import { clampLowerBound } from "../lower-bound";

describe("clampLowerBound", () => {
  it("최소값 · 하드 플로어 · null 만이면 플로어", () => {
    expect(clampLowerBound(["2021-01-01", "2020-06-16", null])).toBe("2020-06-16");
    expect(clampLowerBound(["2019-06-01"])).toBe(MIN_HISTORY_YMD);
    expect(clampLowerBound([null, null])).toBe(MIN_HISTORY_YMD);
  });

  it("오늘을 주면 하한 > 오늘은 오늘로 (#405)", () => {
    expect(clampLowerBound(["2027-03-01"], "2026-09-21")).toBe("2026-09-21");
    expect(clampLowerBound(["2020-06-16"], "2026-09-21")).toBe("2020-06-16");
  });
});
