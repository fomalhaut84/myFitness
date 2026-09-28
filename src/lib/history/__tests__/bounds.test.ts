// #405 · #408: 하한 경계 순수 헬퍼
import { describe, expect, it } from "vitest";
import { clipSpan, coverableDays, effectiveLowerBound } from "../bounds";

describe("effectiveLowerBound", () => {
  it("하한 > 오늘이면 오늘 (#405) · 아니면 그대로", () => {
    expect(effectiveLowerBound("2027-01-01", "2026-09-21")).toBe("2026-09-21");
    expect(effectiveLowerBound("2020-06-16", "2026-09-21")).toBe("2020-06-16");
    expect(effectiveLowerBound("2026-09-21", "2026-09-21")).toBe("2026-09-21");
  });
});

describe("coverableDays (#408-1)", () => {
  it("하한이 버킷 중간이면 하한 이전 일수를 뺀다 · 하한 이전 버킷은 0 · 하한 이후 버킷은 그대로", () => {
    expect(coverableDays({ start: "2020-06-01", totalDays: 30 }, "2020-06-16")).toBe(15);
    expect(coverableDays({ start: "2020-01-20", totalDays: 12 }, "2020-01-20")).toBe(12);
    expect(coverableDays({ start: "2020-05-01", totalDays: 31 }, "2020-06-16")).toBe(0);
    expect(coverableDays({ start: "2024-03-01", totalDays: 31 }, "2020-06-16")).toBe(31);
  });
});

describe("clipSpan (#408-2)", () => {
  const ctx = { lowerBound: "2020-06-16", today: "2026-09-21" };
  it("스팬 ∩ [하한, 오늘] · 비면 null", () => {
    expect(clipSpan({ fromYmd: "2020-06-15", toYmd: "2020-06-21" }, ctx)).toEqual({ fromYmd: "2020-06-16", toYmd: "2020-06-21" });
    expect(clipSpan({ fromYmd: "2026-09-15", toYmd: "2026-09-30" }, ctx)).toEqual({ fromYmd: "2026-09-15", toYmd: "2026-09-21" });
    expect(clipSpan({ fromYmd: "2019-12-30", toYmd: "2020-06-15" }, ctx)).toBeNull();
    expect(clipSpan(null, ctx)).toBeNull();
  });
});
