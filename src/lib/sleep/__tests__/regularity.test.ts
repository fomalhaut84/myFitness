// #455 F4: 수면 규칙성 — KST 시각 · 자정 기준 접기 · 표준편차 · 라벨. `/lifestyle` SleepRegularity 와 같은 임계.
import { describe, expect, it } from "vitest";
import { bedtimeHoursKST, clockHoursKST, formatClockHours, regularityLabel, sleepRegularity } from "../regularity";

const at = (iso: string) => new Date(iso);

describe("clockHoursKST", () => {
  it("KST 시각을 소수 시간으로 · 취침은 18시 이후 −24 (자정 기준) · 기상은 접지 않는다", () => {
    expect(clockHoursKST(at("2026-09-23T14:30:00Z"))).toBe(23.5); // 23:30 KST
    expect(bedtimeHoursKST(at("2026-09-23T14:30:00Z"))).toBe(-0.5);
    expect(clockHoursKST(at("2026-09-23T22:15:00Z"))).toBe(7.25); // 07:15 KST
    expect(bedtimeHoursKST(at("2026-09-23T15:00:00Z"))).toBe(0); // 00:00 KST
  });
  it("formatClockHours 는 음수 · 24 이상을 시계로 되돌린다", () => {
    expect(formatClockHours(-0.5)).toBe("23:30");
    expect(formatClockHours(7.25)).toBe("07:15");
    expect(formatClockHours(24.5)).toBe("00:30");
  });
});

describe("regularityLabel", () => {
  it("0.5 / 1.0 / 1.5 시간 임계", () => {
    expect(regularityLabel(0.4)).toBe("매우 규칙적");
    expect(regularityLabel(0.5)).toBe("규칙적");
    expect(regularityLabel(1.2)).toBe("보통");
    expect(regularityLabel(1.5)).toBe("불규칙");
  });
});

describe("sleepRegularity", () => {
  it("취침 · 기상 평균 시각과 표준편차 (모집단) · 라벨은 취침 기준", () => {
    const rows = [
      { sleepStart: at("2026-09-20T14:00:00Z"), sleepEnd: at("2026-09-20T22:00:00Z") }, // 23:00 → 07:00
      { sleepStart: at("2026-09-21T15:00:00Z"), sleepEnd: at("2026-09-21T22:00:00Z") }, // 00:00 → 07:00
      { sleepStart: at("2026-09-22T14:00:00Z"), sleepEnd: at("2026-09-22T23:00:00Z") }, // 23:00 → 08:00
      { sleepStart: at("2026-09-23T15:00:00Z"), sleepEnd: at("2026-09-23T22:00:00Z") }, // 00:00 → 07:00
    ];
    const r = sleepRegularity(rows);
    expect(r?.n).toBe(4);
    expect(r?.bedtime.meanClock).toBe("23:30");
    expect(r?.bedtime.stdDevHours).toBeCloseTo(0.5, 6);
    expect(r?.wake.meanClock).toBe("07:15");
    expect(r?.wake.stdDevHours).toBeCloseTo(Math.sqrt(0.1875), 6);
    expect(r?.label).toBe("규칙적");
  });

  it("2건 미만이면 null", () => {
    expect(sleepRegularity([])).toBeNull();
    expect(sleepRegularity([{ sleepStart: at("2026-09-20T14:00:00Z"), sleepEnd: at("2026-09-20T22:00:00Z") }])).toBeNull();
  });
});
