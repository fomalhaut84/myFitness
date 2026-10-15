// 회귀: #521 (PR #520 Codex P2) — backfill:history 기본 타입에 OMRON 이 들어가 마커 null → --to 가 어제가 되어
// Garmin 전 타입이 수개월치를 재조회했고, OMRON 만 고른 백필도 Garmin 로그인을 요구했다. 혼합 명시도 거부 (사전 리뷰 major 1)
import { describe, expect, it } from "vitest";
import { mixedProviderError, needsGarminLogin } from "../backfill-chunks";
import { isOmronDataType } from "@/lib/omron/data-types";

describe("isOmronDataType", () => {
  it("OMRON 두 타입만 true", () => {
    expect(isOmronDataType("omron_blood_pressure")).toBe(true);
    expect(isOmronDataType("omron_body_composition")).toBe(true);
    expect(isOmronDataType("blood_pressure")).toBe(false);
  });
});

// 사전 리뷰 major 1: 섞으면 OMRON 범위 구멍 · 첫 싱크 전 no-op 성공 · 또는 Garmin 과다 재조회
describe("mixedProviderError — Garmin · OMRON 혼합 거부", () => {
  it("섞이면 오류 메시지", () => {
    expect(mixedProviderError(["sleep", "omron_blood_pressure"])).toMatch(/섞을 수 없습니다/);
  });

  it("한 provider 만이면 null", () => {
    expect(mixedProviderError(["sleep", "body_composition"])).toBeNull();
    expect(mixedProviderError(["omron_blood_pressure", "omron_body_composition"])).toBeNull();
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
