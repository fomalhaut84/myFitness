// 회귀: #572 (PR #571 Codex P2) — 재싱크 창 (최근 30일) 만 새 역치로 다시 분류돼 라벨이 섞였다
import { describe, expect, it } from "vitest";
import { keepStoredIntensity } from "../intensity-sync";

const FIELDS = {
  zoneDistribution: { z1: 1 },
  estimatedZone: 2,
  intensityScore: 40,
  intensityLabel: "easy",
  powerZoneDistribution: { z1: 1 },
  powerEstimatedZone: 1,
  powerIntensityScore: 40,
  powerIntensityLabel: "easy",
};

describe("keepStoredIntensity", () => {
  it("새 활동 (기존 행 없음) → 그대로", () => {
    expect(keepStoredIntensity(FIELDS, undefined)).toEqual(FIELDS);
  });

  it("이미 분류된 기준은 덮어쓰지 않는다 · 빈 기준만 채운다", () => {
    expect(Object.keys(keepStoredIntensity(FIELDS, { intensityLabel: "tempo", powerIntensityLabel: "easy" }))).toEqual([]);
    expect(keepStoredIntensity(FIELDS, { intensityLabel: "tempo", powerIntensityLabel: null })).toEqual({
      powerZoneDistribution: { z1: 1 },
      powerEstimatedZone: 1,
      powerIntensityScore: 40,
      powerIntensityLabel: "easy",
    });
    expect(keepStoredIntensity(FIELDS, { intensityLabel: null, powerIntensityLabel: "easy" })).toMatchObject({ intensityLabel: "easy" });
  });

  it("파워 값을 비우는 쓰기 (러닝 외로 종류 변경 · #575) 는 유지", () => {
    const clear = { powerZoneDistribution: null, powerEstimatedZone: null, powerIntensityScore: null, powerIntensityLabel: null };
    expect(keepStoredIntensity(clear, { intensityLabel: "easy", powerIntensityLabel: "easy" })).toEqual(clear);
  });
});
