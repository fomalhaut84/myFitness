// 회귀: #505 — Garmin 체중 행은 bmi = null 이라 키가 있어도 /body BMI 가 "—" 였다
import { describe, expect, it } from "vitest";
import { computeBmi, resolveBmi } from "../bmi";

describe("computeBmi", () => {
  it("체중 / 키(m)² 를 소수점 1자리로", () => {
    expect(computeBmi(87.9, 170)).toBe(30.4);
    expect(computeBmi(70, 175)).toBe(22.9);
  });

  it("키가 없거나 0 이하 · 체중이 0 이하면 null", () => {
    expect(computeBmi(70, null)).toBeNull();
    expect(computeBmi(70, 0)).toBeNull();
    expect(computeBmi(70, -170)).toBeNull();
    expect(computeBmi(0, 170)).toBeNull();
  });
});

describe("resolveBmi", () => {
  it("저장값이 있으면 그대로 (Garmin 원본 · 수동 입력 시점 계산값)", () => {
    expect(resolveBmi(25.1, 87.9, 170)).toBe(25.1);
  });

  it("저장값이 null 이면 키로 계산", () => {
    expect(resolveBmi(null, 87.9, 170)).toBe(30.4);
  });

  it("저장값 · 키 모두 없으면 null", () => {
    expect(resolveBmi(null, 87.9, null)).toBeNull();
  });
});
