// #442 (M17-3): 지표 데이터 시작일 캡션 — 순수 부분. 조회는 `loadMetricDataStart` (prisma).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { dataStartNote, hasDataStart } from "../data-start";
import { getHistoryMetric } from "../metrics";

describe("dataStartNote", () => {
  it("startNote 의 {from} 을 YYYY-MM 으로 치환", () => {
    expect(dataStartNote(getHistoryMetric("hrr2"), "2026-04")).toBe("종료 후 심박은 2026-04 부터 있습니다");
  });

  it("시작일이 없거나 (데이터 0건) 지표에 startNote 가 없으면 null", () => {
    expect(dataStartNote(getHistoryMetric("hrr2"), null)).toBeNull();
    expect(dataStartNote(getHistoryMetric("runningKm"), "2020-06")).toBeNull();
  });

  it("hasDataStart — startNote 가 있는 지표만 조회 대상", () => {
    expect(hasDataStart(getHistoryMetric("hrr2"))).toBe(true);
    expect(hasDataStart(getHistoryMetric("steps"))).toBe(false);
  });
});
