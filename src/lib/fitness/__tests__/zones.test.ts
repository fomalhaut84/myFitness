// 회귀: #510 — LTHR > maxHR 이 저장되면 zone 5 가 min > max 로 뒤집혀 AI 프롬프트 · MCP 에 노출됐다
import { describe, expect, it } from "vitest";
import { getZoneRanges, resolveProfileHrZones } from "../zones";

describe("getZoneRanges zone 5 상한", () => {
  it("maxHR 이 zone 5 하한 이상이면 그대로 상한", () => {
    const z5 = getZoneRanges(160, 180)[4];
    expect(z5).toMatchObject({ min: 160, max: 180 });
  });

  it("maxHR 이 zone 5 하한보다 낮으면 상한을 비운다 (역전 방지)", () => {
    const z5 = getZoneRanges(175, 170)[4];
    expect(z5).toMatchObject({ min: 175, max: null });
  });
});

// 회귀: #570 570-2 사전 리뷰 major — 활동 상세가 Garmin 존으로 센 심박 시간 옆에 Friel 비율 범위를 보여 줬다
describe("resolveProfileHrZones", () => {
  const raw = { zone1Floor: 100, zone2Floor: 120, zone3Floor: 140, zone4Floor: 155, zone5Floor: 165, maxHeartRateUsed: 185, lactateThresholdHeartRateUsed: 165 };
  const base = { maxHR: 185, lthr: 165, maxHRSource: "garmin", lthrSource: "garmin", heartRateZonesRaw: raw };
  const fallback = { maxHR: 185, lthr: 165 };

  it("둘 다 Garmin 값 + 원본이 최신 → Garmin 하한", () => {
    const r = resolveProfileHrZones(base, fallback);
    expect(r.source).toBe("garmin");
    expect(r.zones[2]).toMatchObject({ min: 140, max: 154 });
  });

  it("수동 값 · 원본 뒤처짐 · 원본 없음 → 비율 계산", () => {
    expect(resolveProfileHrZones({ ...base, lthrSource: "manual" }, fallback).source).toBe("calculated");
    expect(resolveProfileHrZones({ ...base, lthr: 170 }, { maxHR: 185, lthr: 170 }).source).toBe("calculated");
    expect(resolveProfileHrZones({ ...base, heartRateZonesRaw: null }, fallback).source).toBe("calculated");
  });
});
