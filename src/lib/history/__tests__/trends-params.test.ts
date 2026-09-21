// #395 (M15-3): /trends 쿼리 파싱 · 기간 해석 · href.
import { describe, expect, it } from "vitest";
import { enumerateBuckets } from "../buckets";
import {
  buildTrendsHref,
  effectiveTrendsRange,
  isMonthRangeTruncated,
  defaultCompareRanges,
  monthRangeLength,
  monthRangeToYmd,
  parseMonthRange,
  parseTrendsQuery,
  resolveTrendsRange,
} from "../trends-params";

const ctx = { today: "2026-09-21", lowerBound: "2020-06-16" };

describe("parseTrendsQuery", () => {
  it("빈 쿼리 = 기본 화면 (시계열 · 러닝 거리 · 월 · 3년)", () => {
    const q = parseTrendsQuery({}, ctx);
    expect(q).toMatchObject({ view: "series", metric: "runningKm", unit: "month", range: "3y" });
  });

  it("잘못된 값은 기본값으로 fallback", () => {
    const q = parseTrendsQuery({ view: "pie", metric: "nope", unit: "day", range: "10y", a: "x", b: "2024-13..2025-01" }, ctx);
    expect(q).toMatchObject({ view: "series", metric: "runningKm", unit: "month", range: "3y" });
    expect(q.a).toEqual(defaultCompareRanges(ctx).a);
    expect(q.b).toEqual(defaultCompareRanges(ctx).b);
  });

  it("선택기 비노출 지표는 기본값으로", () => {
    expect(parseTrendsQuery({ metric: "runningDurationSec" }, ctx).metric).toBe("runningKm");
    expect(parseTrendsQuery({ metric: "weight" }, ctx).metric).toBe("weight");
  });

  it("배열 쿼리는 첫 값", () => {
    expect(parseTrendsQuery({ view: ["yoy", "season"] }, ctx).view).toBe("yoy");
  });
});

describe("resolveTrendsRange", () => {
  it("월 단위: 1y = 이번 달 포함 12개 달, 3y = 36개 달", () => {
    expect(resolveTrendsRange("1y", "month", ctx)).toEqual({ from: "2025-10-01", to: "2026-09-21" });
    expect(resolveTrendsRange("3y", "month", ctx)).toEqual({ from: "2023-10-01", to: "2026-09-21" });
  });

  it("all · 하한 클램프", () => {
    expect(resolveTrendsRange("all", "month", ctx)).toEqual({ from: "2020-06-16", to: "2026-09-21" });
    expect(resolveTrendsRange("3y", "month", { today: "2021-02-10", lowerBound: "2020-06-16" }).from).toBe("2020-06-16");
  });

  // 회귀: #395 사전 리뷰 major 1 — summary 는 첫 버킷을 달력 전체로 조회한다. from 이 버킷 시작이 아니면 막대는 기간 밖
  // 데이터를 포함하는데 "기간 전체" 판독값은 포함하지 않아 같은 화면에서 어긋난다.
  it("from 은 단위의 버킷 시작 — 막대가 덮는 범위와 판독값 범위가 같다", () => {
    for (const unit of ["week", "month", "year"] as const) {
      for (const range of ["1y", "3y", "all"] as const) {
        const { from, to } = resolveTrendsRange(range, unit, ctx);
        const first = enumerateBuckets(from, to, unit, ctx.today)[0];
        // 첫 버킷이 from 보다 앞에서 시작하는 경우는 하한 클램프뿐 (그 앞에는 데이터가 없다)
        expect(first.startYmd === from || from === ctx.lowerBound).toBe(true);
      }
    }
    expect(resolveTrendsRange("1y", "week", ctx).from).toBe("2025-09-29"); // 2025-10-01 이 속한 주의 월요일
  });

  it("연 단위는 기간과 무관하게 전체", () => {
    expect(effectiveTrendsRange("1y", "year")).toBe("all");
    expect(effectiveTrendsRange("1y", "week")).toBe("1y");
    expect(resolveTrendsRange("1y", "year", ctx)).toEqual({ from: "2020-06-16", to: "2026-09-21" });
  });
});

describe("비교 구간", () => {
  it("기본: B = 직전 완결 3개월, A = 1년 전 같은 달들", () => {
    expect(defaultCompareRanges(ctx)).toEqual({
      a: { fromYm: "2025-06", toYm: "2025-08" },
      b: { fromYm: "2026-06", toYm: "2026-08" },
    });
  });

  it("기본 구간이 연 경계를 넘는다", () => {
    expect(defaultCompareRanges({ today: "2026-02-10", lowerBound: "2020-06-16" }).b).toEqual({
      fromYm: "2025-11",
      toYm: "2026-01",
    });
  });

  it("데이터가 1년 미만이면 하한으로 클램프 (from ≤ to 유지)", () => {
    const r = defaultCompareRanges({ today: "2020-09-10", lowerBound: "2020-06-16" });
    expect(r.b).toEqual({ fromYm: "2020-06", toYm: "2020-08" });
    expect(r.a.fromYm <= r.a.toYm).toBe(true);
    expect(r.a.fromYm).toBe("2020-06");
  });

  it("parseMonthRange: 형식 · 역순 · 하한 이전 · 미래 → null", () => {
    expect(parseMonthRange("2023-11..2024-03", ctx)).toEqual({ fromYm: "2023-11", toYm: "2024-03" });
    expect(parseMonthRange("2024-03..2023-11", ctx)).toBeNull();
    expect(parseMonthRange("2020-01..2020-08", ctx)).toBeNull();
    expect(parseMonthRange("2026-08..2026-10", ctx)).toBeNull();
    expect(parseMonthRange("2024-3..2024-05", ctx)).toBeNull();
    expect(parseMonthRange("2024-03", ctx)).toBeNull();
    expect(parseMonthRange(undefined, ctx)).toBeNull();
  });

  it("길이 · ymd 변환 (하한 · 오늘 클램프, 윤년 말일)", () => {
    expect(monthRangeLength({ fromYm: "2023-11", toYm: "2024-03" })).toBe(5);
    expect(monthRangeToYmd({ fromYm: "2023-11", toYm: "2024-02" }, ctx)).toEqual({ from: "2023-11-01", to: "2024-02-29" });
    expect(monthRangeToYmd({ fromYm: "2020-06", toYm: "2026-09" }, ctx)).toEqual({ from: "2020-06-16", to: "2026-09-21" });
  });
});

describe("isMonthRangeTruncated", () => {
  it("이번 달 · 기록 시작일이 걸린 달이 끼면 true", () => {
    expect(isMonthRangeTruncated({ fromYm: "2026-07", toYm: "2026-09" }, ctx)).toBe(true);
    expect(isMonthRangeTruncated({ fromYm: "2020-06", toYm: "2020-08" }, ctx)).toBe(true);
    expect(isMonthRangeTruncated({ fromYm: "2025-07", toYm: "2025-09" }, ctx)).toBe(false);
    // 오늘이 그 달의 말일이면 달력상 잘리지 않는다
    expect(isMonthRangeTruncated({ fromYm: "2026-09", toYm: "2026-09" }, { ...ctx, today: "2026-09-30" })).toBe(false);
  });
});

describe("buildTrendsHref", () => {
  const base = parseTrendsQuery({}, ctx);

  it("기본값은 생략", () => {
    expect(buildTrendsHref(base, {}, ctx)).toBe("/trends");
    expect(buildTrendsHref(base, { view: "yoy", metric: "weight" }, ctx)).toBe("/trends?view=yoy&metric=weight");
  });

  it("단위 · 기간은 다른 탭에서도 유지", () => {
    const q = parseTrendsQuery({ unit: "week", range: "all" }, ctx);
    expect(buildTrendsHref(q, { view: "season" }, ctx)).toBe("/trends?view=season&unit=week&range=all");
  });

  it("비교 구간은 비교 뷰에서만, 기본과 다를 때만", () => {
    const custom = { fromYm: "2023-11", toYm: "2024-03" };
    expect(buildTrendsHref(base, { view: "compare" }, ctx)).toBe("/trends?view=compare");
    expect(buildTrendsHref(base, { view: "compare", a: custom }, ctx)).toBe("/trends?view=compare&a=2023-11..2024-03");
    expect(buildTrendsHref(base, { view: "series", a: custom }, ctx)).toBe("/trends");
  });

  it("빌드한 href 를 다시 파싱하면 같은 쿼리 (왕복)", () => {
    const q = parseTrendsQuery({ view: "compare", metric: "vo2max", a: "2023-11..2024-03", b: "2026-05..2026-09" }, ctx);
    const href = buildTrendsHref(q, {}, ctx);
    const parsed = parseTrendsQuery(Object.fromEntries(new URL(href, "http://x").searchParams), ctx);
    expect(parsed).toEqual(q);
  });
});
