// #394 (M15-2): /history 라우트 세그먼트 검증 · redirect 규칙.
import { describe, expect, it } from "vitest";
import { parseHistoryRoute } from "../route-params";

const ctx = { today: "2026-09-21", lowerBound: "2020-06-16" };

describe("parseHistoryRoute", () => {
  it("정상 3 레벨", () => {
    expect(parseHistoryRoute({ year: "2024" }, ctx)).toEqual({ ok: true, route: { level: "year", year: 2024 } });
    expect(parseHistoryRoute({ year: "2024", month: "03" }, ctx)).toEqual({
      ok: true,
      route: { level: "month", year: 2024, month: 3, ym: "2024-03" },
    });
    expect(parseHistoryRoute({ year: "2024", month: "03", day: "15" }, ctx)).toEqual({
      ok: true,
      route: { level: "day", year: 2024, month: 3, day: 15, ym: "2024-03", ymd: "2024-03-15" },
    });
  });

  it("경계 값은 유효 (하한일 · 오늘)", () => {
    expect(parseHistoryRoute({ year: "2020", month: "06", day: "16" }, ctx).ok).toBe(true);
    expect(parseHistoryRoute({ year: "2026", month: "09", day: "21" }, ctx).ok).toBe(true);
    expect(parseHistoryRoute({ year: "2020", month: "06" }, ctx).ok).toBe(true);
  });

  it("zero-pad 정규형으로 redirect", () => {
    expect(parseHistoryRoute({ year: "2024", month: "3" }, ctx)).toEqual({ ok: false, redirectTo: "/history/2024/03" });
    expect(parseHistoryRoute({ year: "2024", month: "03", day: "5" }, ctx)).toEqual({
      ok: false,
      redirectTo: "/history/2024/03/05",
    });
  });

  it("미래는 오늘 쪽으로", () => {
    expect(parseHistoryRoute({ year: "2031" }, ctx)).toEqual({ ok: false, redirectTo: "/history/2026" });
    expect(parseHistoryRoute({ year: "2026", month: "12" }, ctx)).toEqual({ ok: false, redirectTo: "/history/2026/09" });
    expect(parseHistoryRoute({ year: "2026", month: "09", day: "30" }, ctx)).toEqual({
      ok: false,
      redirectTo: "/history/2026/09/21",
    });
  });

  it("하한 이전은 하한 쪽으로 — 하한이 속한 달의 하한 이전 날짜 포함", () => {
    expect(parseHistoryRoute({ year: "2019" }, ctx)).toEqual({ ok: false, redirectTo: "/history/2020" });
    expect(parseHistoryRoute({ year: "2020", month: "01" }, ctx)).toEqual({ ok: false, redirectTo: "/history/2020/06" });
    expect(parseHistoryRoute({ year: "2020", month: "06", day: "01" }, ctx)).toEqual({
      ok: false,
      redirectTo: "/history/2020/06/16",
    });
  });

  it("실존하지 않는 날짜는 그 달의 월 뷰로", () => {
    expect(parseHistoryRoute({ year: "2024", month: "02", day: "30" }, ctx)).toEqual({
      ok: false,
      redirectTo: "/history/2024/02",
    });
    expect(parseHistoryRoute({ year: "2024", month: "02", day: "29" }, ctx).ok).toBe(true); // 윤년
    expect(parseHistoryRoute({ year: "2023", month: "02", day: "29" }, ctx).ok).toBe(false);
  });

  it("월 범위 밖 · 비숫자 세그먼트", () => {
    expect(parseHistoryRoute({ year: "2024", month: "13" }, ctx)).toEqual({ ok: false, redirectTo: "/history/2024" });
    expect(parseHistoryRoute({ year: "2024", month: "abc" }, ctx)).toEqual({ ok: false, redirectTo: "/history/2024" });
    expect(parseHistoryRoute({ year: "abcd" }, ctx)).toEqual({ ok: false, redirectTo: "/history" });
    expect(parseHistoryRoute({ year: "24" }, ctx)).toEqual({ ok: false, redirectTo: "/history" });
    expect(parseHistoryRoute({ year: "2024", month: "03", day: "x" }, ctx)).toEqual({
      ok: false,
      redirectTo: "/history/2024/03",
    });
  });
});
