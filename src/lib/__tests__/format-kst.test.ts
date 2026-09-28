// #365: 포맷 헬퍼가 호스트 TZ 와 무관하게 KST 를 말한다. 경계 instant = KST 자정 (UTC 로는 전날 15:00).
import { describe, expect, it } from "vitest";
import { formatDateKST, formatDateLocal, formatDateTime, formatRelativeDate } from "../format";

const kstMidnight = new Date("2026-04-06T00:00:00+09:00");
const kstMorning = "2026-04-06T06:30:00+09:00"; // = 2026-04-05T21:30Z

describe("formatDateLocal (KST)", () => {
  it("DB 의 KST 자정 date → 같은 날", () => {
    expect(formatDateLocal(kstMidnight)).toBe("2026-04-06");
  });
});

describe("formatDateKST", () => {
  it("ko-KR · timeZone Asia/Seoul · 옵션 전달", () => {
    expect(formatDateKST(kstMidnight)).toBe("2026. 4. 6.");
    expect(formatDateKST(kstMidnight, { month: "short", day: "numeric" })).toBe("4월 6일");
  });
});

describe("formatRelativeDate (KST)", () => {
  it("오늘 · 어제 · N일 전 · M월 D일 — 아침 러닝 (UTC 로는 전날 밤)", () => {
    const now = new Date("2026-04-06T20:00:00+09:00");
    expect(formatRelativeDate(kstMorning, now)).toBe("오늘 06:30");
    expect(formatRelativeDate(kstMorning, new Date("2026-04-07T01:00:00+09:00"))).toBe("어제 06:30");
    expect(formatRelativeDate(kstMorning, new Date("2026-04-09T12:00:00+09:00"))).toBe("3일 전");
    expect(formatRelativeDate(kstMorning, new Date("2026-05-01T12:00:00+09:00"))).toBe("4월 6일");
  });
});

describe("formatDateTime (KST)", () => {
  it("YYYY.MM.DD HH:mm", () => {
    expect(formatDateTime(kstMorning)).toBe("2026.04.06 06:30");
  });
});
