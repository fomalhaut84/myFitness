// 회귀: #514 사전 리뷰 major 2 — 수동 체중이 같은 날 OMRON 행을 덮을 때 OMRON 전용 필드가 남아 manual 행에 출처가 섞였다
import { describe, expect, it } from "vitest";
import { manualBodyCompositionData } from "../body-manual";

describe("manualBodyCompositionData", () => {
  it("OMRON 전용 필드를 명시적으로 비운다", () => {
    expect(manualBodyCompositionData({ weight: 80.2, bmi: 27.7 })).toEqual({
      weight: 80.2,
      bmi: 27.7,
      bodyFat: null,
      muscleMass: null,
      visceralFatLevel: null,
      basalMetabolism: null,
      bodyAge: null,
      skeletalMusclePct: null,
      source: "manual",
    });
  });

  it("입력한 체지방 · 근육량은 그대로", () => {
    expect(manualBodyCompositionData({ weight: 80, bmi: null, bodyFat: 25.1, muscleMass: 30 })).toMatchObject({
      bodyFat: 25.1,
      muscleMass: 30,
    });
  });
});
