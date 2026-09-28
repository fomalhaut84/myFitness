// #480: date-only 입력은 서버 로컬 자정이 아니라 KST 자정 — 호스트 TZ 가 서울보다 동쪽이면 로컬 자정을 KST 로 읽을 때 하루 앞이 된다
import { describe, expect, it } from "vitest";
import { ymdKST } from "@/lib/garmin/utils";
import { parseDateOnlyKST } from "../date-input";

describe("parseDateOnlyKST", () => {
  it("YYYY-MM-DD → KST 자정 instant (UTC 로는 전날 15:00) · ymdKST 왕복", () => {
    const d = parseDateOnlyKST("2026-09-28");
    expect(d.toISOString()).toBe("2026-09-27T15:00:00.000Z");
    expect(ymdKST(d)).toBe("2026-09-28");
    expect(ymdKST(parseDateOnlyKST("2024-02-29"))).toBe("2024-02-29");
  });

  it("실존하지 않는 날짜 · 형식 오류는 throw", () => {
    expect(() => parseDateOnlyKST("2026-02-30")).toThrow();
    expect(() => parseDateOnlyKST("2026/09/28")).toThrow();
    expect(() => parseDateOnlyKST("")).toThrow();
  });
});
