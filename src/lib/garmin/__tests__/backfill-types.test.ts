// 회귀: #521 (PR #520 Codex P2) — backfill:history 기본 타입에 OMRON 이 들어가 마커 null → --to 가 어제가 되어
// Garmin 전 타입이 수개월치를 재조회했고, OMRON 만 고른 백필도 Garmin 로그인을 요구했다
import { describe, expect, it } from "vitest";
import { markerTypes, needsGarminLogin } from "../backfill-chunks";
import { isOmronDataType } from "@/lib/omron/data-types";

describe("isOmronDataType", () => {
  it("OMRON 두 타입만 true", () => {
    expect(isOmronDataType("omron_blood_pressure")).toBe(true);
    expect(isOmronDataType("omron_body_composition")).toBe(true);
    expect(isOmronDataType("blood_pressure")).toBe(false);
  });
});

describe("markerTypes — --to 기본값 계산 대상", () => {
  it("Garmin 타입이 있으면 OMRON 은 마커 계산에서 뺀다 (OMRON 은 1회 호출로 전 기간)", () => {
    expect(markerTypes(["sleep", "omron_blood_pressure", "body_composition"])).toEqual(["sleep", "body_composition"]);
  });

  it("OMRON 만 고르면 그대로 (마커 없으면 어제 기준)", () => {
    expect(markerTypes(["omron_blood_pressure"])).toEqual(["omron_blood_pressure"]);
  });
});

describe("needsGarminLogin", () => {
  it("Garmin 타입이 하나라도 있으면 로그인", () => {
    expect(needsGarminLogin(["omron_body_composition", "activities"])).toBe(true);
  });

  it("OMRON 만이면 로그인 생략", () => {
    expect(needsGarminLogin(["omron_body_composition", "omron_blood_pressure"])).toBe(false);
  });
});
