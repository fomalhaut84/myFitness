// #570: Garmin 러닝 역치파워 싱크 규칙 — 가상 값
import { describe, expect, it } from "vitest";
import { parseLatestThresholdPower, parseNaiveKst, planPowerSync } from "../power-profile";

const RUNNING = { sport: "RUNNING", functionalThresholdPower: 300, zone1Floor: 195, zone2Floor: 240, zone3Floor: 270, zone4Floor: 300, zone5Floor: 345, zone6Floor: 0, zone7Floor: 0 };
const ZONES = [{ ...RUNNING, sport: "CYCLING", functionalThresholdPower: 200 }, RUNNING];
const LATEST = { sport: "RUNNING", functionalThresholdPower: 300, calendarDate: "2026-01-02T07:30:00.0", biometricSourceType: "CHANGE_LOG" };
const EMPTY = { thresholdPower: null, thresholdPowerSource: null };

describe("planPowerSync", () => {
  it("최초 싱크 — 값 · 출처 · 존 원본 · 시각 · 감지 여부 + 이력", () => {
    const plan = planPowerSync(EMPTY, { powerZones: ZONES, latest: LATEST, ftpAutoDetected: true });
    expect(plan.updates).toMatchObject({ thresholdPower: 300, thresholdPowerSource: "garmin", thresholdPowerAutoDetected: true });
    expect(plan.updates.powerZonesRaw?.zone4Floor).toBe(300);
    expect(plan.updates.thresholdPowerMeasuredAt?.toISOString()).toBe("2026-01-01T22:30:00.000Z");
    expect(plan.change).toEqual({ oldValue: null, newValue: 300 });
  });

  it("값 그대로면 이력 없음", () => {
    const plan = planPowerSync({ thresholdPower: 300, thresholdPowerSource: "garmin" }, { powerZones: ZONES, latest: LATEST, ftpAutoDetected: true });
    expect(plan.change).toBeNull();
    expect(plan.updates.thresholdPower).toBeUndefined();
  });

  it("수동 값은 보호 — 존 원본만 갱신", () => {
    const plan = planPowerSync({ thresholdPower: 280, thresholdPowerSource: "manual" }, { powerZones: ZONES, latest: LATEST, ftpAutoDetected: true });
    expect(plan.change).toBeNull();
    expect(plan.updates).toEqual({ powerZonesRaw: expect.objectContaining({ functionalThresholdPower: 300 }) });
  });

  it("두 엔드포인트 실패 → 아무것도 바꾸지 않는다 (null 로 덮지 않음)", () => {
    const plan = planPowerSync({ thresholdPower: 300, thresholdPowerSource: "garmin" }, { powerZones: undefined, latest: undefined, ftpAutoDetected: undefined });
    expect(plan.updates).toEqual({});
    expect(plan.warnings).toEqual([]);
  });

  it("RUNNING 없음 → latest 로 값만, 경고 기록", () => {
    const plan = planPowerSync(EMPTY, { powerZones: [{ ...RUNNING, sport: "ROWING" }], latest: LATEST, ftpAutoDetected: undefined });
    expect(plan.updates.thresholdPower).toBe(300);
    expect(plan.updates.powerZonesRaw).toBeUndefined();
    expect(plan.warnings).toHaveLength(1);
  });

  it("범위 밖 역치파워는 무시", () => {
    const plan = planPowerSync(EMPTY, { powerZones: [{ ...RUNNING, functionalThresholdPower: 5000 }], latest: undefined, ftpAutoDetected: undefined });
    expect(plan.updates).toEqual({});
    expect(plan.warnings[0]).toContain("범위 밖");
  });

  // 회귀: PR #571 Codex P2 — 새 FTP 에 이전 FTP 의 감지 시각이 남았다
  it("값이 바뀌었는데 latest 가 다른 값 · 실패면 시각을 비운다", () => {
    const prev = { thresholdPower: 280, thresholdPowerSource: "garmin" };
    const mismatch = planPowerSync(prev, { powerZones: ZONES, latest: { ...LATEST, functionalThresholdPower: 290 }, ftpAutoDetected: undefined });
    expect(mismatch.updates.thresholdPower).toBe(300);
    expect(mismatch.updates.thresholdPowerMeasuredAt).toBeNull();
    expect(planPowerSync(prev, { powerZones: ZONES, latest: undefined, ftpAutoDetected: undefined }).updates.thresholdPowerMeasuredAt).toBeNull();
  });

  it("값이 그대로면 latest 가 달라도 기존 시각 유지", () => {
    const plan = planPowerSync({ thresholdPower: 300, thresholdPowerSource: "garmin" }, { powerZones: ZONES, latest: undefined, ftpAutoDetected: undefined });
    expect(plan.updates.thresholdPowerMeasuredAt).toBeUndefined();
  });
});

describe("parseLatestThresholdPower · parseNaiveKst", () => {
  it("다른 종목 · 형태 불일치 → null", () => {
    expect(parseLatestThresholdPower({ ...LATEST, sport: "CYCLING" })).toBeNull();
    expect(parseLatestThresholdPower([])).toBeNull();
    expect(parseLatestThresholdPower({ functionalThresholdPower: "300" })).toBeNull();
  });

  it("naive 로컬은 KST, 형식 밖은 null", () => {
    expect(parseNaiveKst("2026-01-02T09:00:00")?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(parseNaiveKst("2026-01-02")).toBeNull();
    expect(parseNaiveKst(null)).toBeNull();
  });
});
