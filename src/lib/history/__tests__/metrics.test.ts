// #393 (M15-1) 회귀: 지표 레지스트리 정합. id 유일 · 초기 세트 · 규칙별 플래그 조합.
import { describe, expect, it } from "vitest";
import {
  HISTORY_METRICS,
  HISTORY_METRIC_IDS,
  HISTORY_PRIMARY_METRIC_IDS,
  getHistoryMetric,
  isHistoryMetricId,
  selectableHistoryMetrics,
} from "../metrics";
import { clampLowerBound } from "../lower-bound";

describe("HISTORY_METRICS", () => {
  it("id 는 유일하고 HISTORY_METRIC_IDS 와 일치", () => {
    const ids = HISTORY_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...HISTORY_METRIC_IDS]);
  });

  it("m15-overview D3 초기 5개 지표가 있다", () => {
    for (const id of ["runningKm", "steps", "sleepScore", "restingHR", "weight"]) {
      expect(isHistoryMetricId(id)).toBe(true);
    }
  });

  it("missingAsZero 는 sum 형 활동 지표에만", () => {
    for (const m of HISTORY_METRICS) {
      if (m.missingAsZero) expect(m.aggregate === "sum" && m.source === "activity").toBe(true);
    }
  });

  it("withMinMax 는 avg 형에만", () => {
    for (const m of HISTORY_METRICS) {
      if (m.withMinMax) expect(m.aggregate).toBe("avg");
    }
  });

  it("#394: 선택기 비노출 지표는 selectable 목록에서 빠지고, 기본 5개는 전부 selectable", () => {
    const selectable = selectableHistoryMetrics().map((m) => m.id);
    expect(selectable).not.toContain("runningDurationSec");
    for (const id of HISTORY_PRIMARY_METRIC_IDS) expect(selectable).toContain(id);
    expect(selectable).toContain("intakeKcal");
    expect(selectable).toContain("calorieBalance");
  });

  it("getHistoryMetric 은 미등록 id 에 throw", () => {
    expect(() => getHistoryMetric("nope" as never)).toThrow();
  });
});

describe("clampLowerBound (PR #398 Codex P2)", () => {
  it("max(MIN_HISTORY_YMD, 최초 기록일 최소값)", () => {
    expect(clampLowerBound(["2020-06-19", "2020-06-16", null, "2020-06-26"])).toBe("2020-06-16");
    // backfill 조회 범위(2019-06-01)가 아니라 하한으로 클램프
    expect(clampLowerBound(["2019-06-01"])).toBe("2020-01-01");
  });

  it("기록이 하나도 없으면 MIN_HISTORY_YMD", () => {
    expect(clampLowerBound([null, null])).toBe("2020-01-01");
    expect(clampLowerBound([])).toBe("2020-01-01");
  });
});
