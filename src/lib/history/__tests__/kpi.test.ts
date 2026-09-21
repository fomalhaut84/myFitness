// #394 (M15-2): 연·월 KPI — 평균 페이스는 시간 합 / 거리 합, 결측은 null ("기록 없음").
import { describe, expect, it } from "vitest";
import { averagePaceSecPerKm, buildHistoryKpis } from "../kpi";
import { formatHistoryCellValue, formatHistoryValue, historyDisplayUnit } from "../format";
import { getHistoryMetric } from "../metrics";

describe("averagePaceSecPerKm", () => {
  it("시간 합 / 거리 합 (활동별 페이스의 평균이 아니다)", () => {
    // 5km@300s/km + 20km@360s/km → (1500+7200)/25 = 348, 페이스 평균이면 330
    expect(averagePaceSecPerKm(8700, 25)).toBe(348);
  });

  it("거리 0 · 결측이면 null", () => {
    expect(averagePaceSecPerKm(0, 0)).toBeNull();
    expect(averagePaceSecPerKm(100, 0)).toBeNull();
    expect(averagePaceSecPerKm(null, 10)).toBeNull();
    expect(averagePaceSecPerKm(undefined, undefined)).toBeNull();
  });
});

describe("buildHistoryKpis", () => {
  it("값이 있으면 단위 규칙대로 표시", () => {
    const kpis = buildHistoryKpis({
      runningKm: { value: 1853.61, coveredDays: 191 },
      runningCount: { value: 191, coveredDays: 191 },
      runningDurationSec: { value: 1853.61 * 357, coveredDays: 191 },
      vo2max: { value: 49.8, coveredDays: 300, last: 49.1 },
      restingHR: { value: 51, coveredDays: 360 },
      sleepScore: { value: 77, coveredDays: 350 },
      weight: { value: 71.9, coveredDays: 80, last: 72.9 },
    });
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.text]));
    expect(byKey).toEqual({
      km: "1,853.61",
      count: "191",
      pace: `5'57"`,
      vo2max: "49.8",
      rhr: "51",
      sleep: "77",
      weight: "72.9", // 평균(71.9)이 아니라 기간 말 값
    });
  });

  it("결측은 null, 러닝 0 은 0 (결측 ≠ 0)", () => {
    const kpis = buildHistoryKpis({
      runningKm: { value: 0, coveredDays: 0 },
      runningCount: { value: 0, coveredDays: 0 },
      runningDurationSec: { value: 0, coveredDays: 0 },
      vo2max: { value: null, coveredDays: 0, last: null },
      weight: { value: null, coveredDays: 0, last: null },
    });
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k.text]));
    expect(byKey.km).toBe("0.00");
    expect(byKey.count).toBe("0");
    expect(byKey.pace).toBeNull();
    expect(byKey.vo2max).toBeNull();
    expect(byKey.rhr).toBeNull();
    expect(byKey.weight).toBeNull();
  });
});

describe("formatHistoryValue / formatHistoryCellValue", () => {
  it("decimals 규칙", () => {
    expect(formatHistoryValue({ decimals: 2 }, 12.5)).toBe("12.50");
    expect(formatHistoryValue({ decimals: 0 }, 13098)).toBe("13,098");
    expect(formatHistoryValue({ decimals: 1 }, 71)).toBe("71.0");
  });

  it("셀 축약: 1만 이상 k, 소수 2자리 지표는 1자리", () => {
    expect(formatHistoryCellValue({ decimals: 0 }, 17812)).toBe("17.8k");
    expect(formatHistoryCellValue({ decimals: 0 }, 7712)).toBe("7,712");
    expect(formatHistoryCellValue({ decimals: 2 }, 12.46)).toBe("12.5");
    expect(formatHistoryCellValue({ decimals: 1 }, 71.2)).toBe("71.2");
  });

  // 회귀: PR #402 Codex P2 — 선택 가능한 ltPace (sec/km) 가 `321 sec/km` 로 그려졌다.
  it("pace 지표는 앱 페이스 표기 + /km", () => {
    const ltPace = getHistoryMetric("ltPace");
    expect(formatHistoryValue(ltPace, 321)).toBe(`5'21"`);
    expect(formatHistoryCellValue(ltPace, 321)).toBe(`5'21"`);
    expect(historyDisplayUnit(ltPace)).toBe("/km");
    expect(historyDisplayUnit(getHistoryMetric("weight"))).toBe("kg");
  });
});
