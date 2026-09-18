// #393 (M15-1) 회귀: KST 달력 버킷. 서버 TZ 와 무관하게 KST 달력 문자열로만 계산한다.
import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  bucketKeyOf,
  bucketSpan,
  enumerateBuckets,
  isValidYmd,
  kstDayRange,
  kstInstant,
  startOfMonthYmd,
  startOfWeekYmd,
  startOfYearYmd,
} from "../buckets";

describe("kstInstant / kstDayRange", () => {
  it("KST 자정 instant 는 UTC 전날 15:00", () => {
    expect(kstInstant("2024-03-01").toISOString()).toBe("2024-02-29T15:00:00.000Z");
  });

  it("kstDayRange 는 [자정, 다음 자정) 24시간", () => {
    const { start, end } = kstDayRange("2024-03-15");
    expect(start.toISOString()).toBe("2024-03-14T15:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isValidYmd", () => {
  it("형식·실존 검사", () => {
    expect(isValidYmd("2024-02-29")).toBe(true); // 윤년
    expect(isValidYmd("2023-02-29")).toBe(false);
    expect(isValidYmd("2024-13-01")).toBe(false);
    expect(isValidYmd("2024-3-1")).toBe(false);
    expect(isValidYmd("")).toBe(false);
  });
});

describe("addDaysYmd", () => {
  it("월·연 경계를 넘는다", () => {
    expect(addDaysYmd("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysYmd("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDaysYmd("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDaysYmd("2024-01-01", -1)).toBe("2023-12-31");
  });
});

describe("start of week/month/year (KST 달력)", () => {
  it("일요일은 6일 전 월요일", () => {
    expect(startOfWeekYmd("2024-03-17")).toBe("2024-03-11"); // 일
    expect(startOfWeekYmd("2024-03-11")).toBe("2024-03-11"); // 월
    expect(startOfWeekYmd("2024-03-13")).toBe("2024-03-11"); // 수
  });

  it("월·연 시작", () => {
    expect(startOfMonthYmd("2024-03-15")).toBe("2024-03-01");
    expect(startOfYearYmd("2024-03-15")).toBe("2024-01-01");
  });
});

describe("bucketKeyOf", () => {
  it("단위별 키 = 시작일 문자열", () => {
    expect(bucketKeyOf("2024-03-15", "day")).toBe("2024-03-15");
    expect(bucketKeyOf("2024-03-17", "week")).toBe("2024-03-11");
    expect(bucketKeyOf("2024-03-15", "month")).toBe("2024-03");
    expect(bucketKeyOf("2024-03-15", "year")).toBe("2024");
  });

  it("KST 월 경계: 3월 1일은 2월 버킷에 들어가지 않는다", () => {
    expect(bucketKeyOf("2024-03-01", "month")).toBe("2024-03");
    expect(bucketKeyOf("2024-02-29", "month")).toBe("2024-02");
  });
});

describe("enumerateBuckets", () => {
  const today = "2026-09-18";

  it("월 버킷: 빈 달 포함 · 첫 버킷을 from 으로 자르지 않는다 · 윤년 2월 29일", () => {
    const buckets = enumerateBuckets("2024-01-15", "2024-03-10", "month", today);
    expect(buckets.map((b) => b.key)).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(buckets[0].startYmd).toBe("2024-01-01");
    expect(buckets[0].endYmd).toBe("2024-02-01");
    expect(buckets[1].totalDays).toBe(29);
    expect(buckets[2].endYmd).toBe("2024-04-01");
    expect(buckets[2].totalDays).toBe(31);
  });

  it("주 버킷: from 이 속한 주의 월요일부터", () => {
    const buckets = enumerateBuckets("2024-03-14", "2024-03-18", "week", today);
    expect(buckets.map((b) => b.key)).toEqual(["2024-03-11", "2024-03-18"]);
    expect(buckets[0].endYmd).toBe("2024-03-18");
    expect(buckets[0].totalDays).toBe(7);
  });

  it("연 버킷", () => {
    const buckets = enumerateBuckets("2023-06-01", "2024-02-01", "year", today);
    expect(buckets.map((b) => b.key)).toEqual(["2023", "2024"]);
    expect(buckets[1].totalDays).toBe(366);
  });

  it("일 버킷: 하루 1개", () => {
    const buckets = enumerateBuckets("2024-02-28", "2024-03-01", "day", today);
    expect(buckets.map((b) => b.key)).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(buckets[0].totalDays).toBe(1);
  });

  it("오늘 이후 날짜는 totalDays 에 세지 않는다", () => {
    const buckets = enumerateBuckets("2026-09-01", "2026-09-18", "month", today);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].totalDays).toBe(18);
    const year = enumerateBuckets("2026-01-01", "2026-09-18", "year", today);
    expect(year[0].totalDays).toBe(261);
  });

  it("버킷 instant 경계는 KST 자정", () => {
    const [b] = enumerateBuckets("2024-03-15", "2024-03-15", "month", today);
    expect(b.start.toISOString()).toBe("2024-02-29T15:00:00.000Z");
    expect(b.end.toISOString()).toBe("2024-03-31T15:00:00.000Z");
    expect(b.granularity).toBe("month");
  });

  it("연 경계를 넘는 주: 2024-12-30 주는 하나의 버킷 · 7일", () => {
    const buckets = enumerateBuckets("2024-12-30", "2025-01-02", "week", today);
    expect(buckets.map((b) => b.key)).toEqual(["2024-12-30"]);
    expect(buckets[0].endYmd).toBe("2025-01-06");
    expect(buckets[0].totalDays).toBe(7);
  });

  it("bucketSpan 은 첫 버킷 시작 ~ 끝 버킷 마지막 날 (inclusive) — 조회 범위", () => {
    const buckets = enumerateBuckets("2024-03-15", "2024-05-20", "month", today);
    expect(bucketSpan(buckets)).toEqual({ fromYmd: "2024-03-01", toYmd: "2024-05-31" });
    expect(bucketSpan([])).toBeNull();
  });

  it("from > to 면 빈 배열", () => {
    expect(enumerateBuckets("2024-03-02", "2024-03-01", "day", today)).toEqual([]);
  });
});
