// #570: 시스템 프롬프트 강도 기준 · 파워 존 섹션 — 가상 값
import { describe, expect, it } from "vitest";
import { buildPowerSection } from "../power-section";

const BASE = { thresholdPower: 300, thresholdPowerSource: "manual", powerZonesRaw: null, intensityBasis: "auto" };

describe("buildPowerSection", () => {
  it("기준 + 파워 존 표", () => {
    const text = buildPowerSection(BASE).join("\n");
    expect(text).toContain("강도 평가 기준: 자동");
    expect(text).toContain("역치파워 300 W · 역치 대비 계산");
    expect(text).toContain("Zone 3 (역치): 270-299 W");
    expect(text).toContain("Zone 5 (반복): 345+ W");
  });

  it("프로필 없음 → 심박 기준만", () => {
    expect(buildPowerSection(null).join("\n")).toContain("강도 평가 기준: 심박 존");
  });

  it("파워 기준인데 역치파워 없음 → 안내", () => {
    const text = buildPowerSection({ ...BASE, thresholdPower: null, intensityBasis: "power" }).join("\n");
    expect(text).toContain("역치파워 미설정");
    expect(text).not.toContain("러닝 파워 Zone");
  });
});
