// #505: 프로필 카드에 수동 값과 나란히 보여줄 Garmin 값 — heartRateZonesRaw 는 외부 JSON 이라 형태를 검증한다
import { describe, expect, it } from "vitest";
import { extractGarminZoneValues } from "../profile-values";

describe("extractGarminZoneValues", () => {
  it("RUNNING 존 raw 에서 maxHR · LTHR 을 꺼낸다", () => {
    expect(
      extractGarminZoneValues({
        sport: "RUNNING",
        maxHeartRateUsed: 175,
        lactateThresholdHeartRateUsed: 155,
        restingHeartRateUsed: 54,
      })
    ).toEqual({ maxHR: 175, lthr: 155 });
  });

  it("필드가 없거나 숫자가 아니면 그 값만 null", () => {
    expect(
      extractGarminZoneValues({ maxHeartRateUsed: "175", lactateThresholdHeartRateUsed: null })
    ).toEqual({ maxHR: null, lthr: null });
    expect(extractGarminZoneValues({ maxHeartRateUsed: 175 })).toEqual({ maxHR: 175, lthr: null });
  });

  it("객체가 아니면 둘 다 null", () => {
    expect(extractGarminZoneValues(null)).toEqual({ maxHR: null, lthr: null });
    expect(extractGarminZoneValues([175])).toEqual({ maxHR: null, lthr: null });
    expect(extractGarminZoneValues("x")).toEqual({ maxHR: null, lthr: null });
  });
});
