// #393 (M15-1) 회귀: /api/activities · /api/export 공용 from/to (KST 달력일 inclusive).
import { describe, expect, it } from "vitest";
import { parseYmdRangeParams } from "../range-params";
import { kstDayRange } from "../buckets";

describe("parseYmdRangeParams", () => {
  it("둘 다 없으면 필터 없음 (기존 동작)", () => {
    expect(parseYmdRangeParams(null, undefined)).toEqual({ ok: true, where: null, from: null, to: null });
    expect(parseYmdRangeParams("", "")).toEqual({ ok: true, where: null, from: null, to: null });
  });

  it("to 는 inclusive — lt 가 다음 날 KST 자정", () => {
    const r = parseYmdRangeParams("2024-03-01", "2024-03-31");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.where).toEqual({ gte: kstDayRange("2024-03-01").start, lt: kstDayRange("2024-03-31").end });
    expect(r.where?.lt?.toISOString()).toBe("2024-03-31T15:00:00.000Z");
  });

  it("한쪽만 줘도 된다", () => {
    const f = parseYmdRangeParams("2024-03-01", null);
    expect(f.ok && f.where).toEqual({ gte: kstDayRange("2024-03-01").start });
    const t = parseYmdRangeParams(null, "2024-03-31");
    expect(t.ok && t.where).toEqual({ lt: kstDayRange("2024-03-31").end });
  });

  it("형식·실존 오류 · 역순은 실패", () => {
    expect(parseYmdRangeParams("2024-13-01", null).ok).toBe(false);
    expect(parseYmdRangeParams(null, "2023-02-29").ok).toBe(false);
    expect(parseYmdRangeParams("2024-03-02", "2024-03-01").ok).toBe(false);
  });
});
