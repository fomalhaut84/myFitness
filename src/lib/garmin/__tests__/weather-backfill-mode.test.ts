// #390: syncAll 의 weather backfill 실행 모드 — backfill 스크립트가 skip 해 $disconnect 뒤 lock 해제 실패를 막는다
import { describe, expect, it } from "vitest";
import { resolveWeatherBackfillMode, weatherBackfillPlan } from "../weather-backfill-mode";

describe("resolveWeatherBackfillMode", () => {
  it("미지정은 background (현행 fire-and-forget)", () => {
    expect(resolveWeatherBackfillMode(undefined)).toBe("background");
    expect(resolveWeatherBackfillMode("skip")).toBe("skip");
    expect(resolveWeatherBackfillMode("await")).toBe("await");
  });
});

describe("weatherBackfillPlan", () => {
  it("background → 실행하되 기다리지 않음 · await → 실행하고 기다림 · skip → 실행 안 함", () => {
    expect(weatherBackfillPlan("background")).toEqual({ run: true, awaitResult: false });
    expect(weatherBackfillPlan("await")).toEqual({ run: true, awaitResult: true });
    expect(weatherBackfillPlan("skip")).toEqual({ run: false, awaitResult: false });
  });
});
