import { describe, expect, it } from "vitest";
import { parseDevices, parseMeasures, toBpReading, toScaleReading } from "../parse";
import { bp, idx, kst, measure, measureResponse, scale } from "./fixtures";

describe("parseMeasures", () => {
  it("bodyIndexList 값을 value × 10^exponent 로 변환한다", () => {
    const { measures } = parseMeasures(measureResponse("1", [scale("2026-10-01 07:10", 8860)]));
    expect(measures).toHaveLength(1);
    expect(measures[0].values["257"]).toBe(88.6);
    expect(measures[0].values["262"]).toBe(30.8);
    expect(measures[0].measuredAt.toISOString()).toBe(new Date(kst("2026-10-01 07:10")).toISOString());
  });

  it("returnedValue 가 배열이어도 첫 원소를 쓴다", () => {
    const resp = measureResponse("0", [bp("2026-10-01 07:00", 130, 85, 60)]);
    const { measures } = parseMeasures({ returnedValue: [resp.returnedValue] });
    expect(measures).toHaveLength(1);
  });

  it("형태가 다르면 예외 대신 빈 결과 + 오류 사유", () => {
    expect(parseMeasures({ returnedValue: { errorCode: "E1" } })).toMatchObject({ measures: [], error: expect.any(String) });
    expect(parseMeasures(null)).toMatchObject({ measures: [], error: expect.any(String) });
  });

  it("숫자로 읽을 수 없는 코드는 그 코드만 버린다", () => {
    const m = measure(kst("2026-10-01 07:00"), { "1": idx(130), "2": ["x", "0", "0", "0"], "3": idx(60) });
    const { measures } = parseMeasures(measureResponse("0", [m]));
    expect(measures[0].values).toEqual({ "1": 130, "3": 60 });
  });

  it("measureDateTo 가 없는 레코드는 skip 하고 센다", () => {
    const bad = { ...bp("2026-10-01 07:00", 130, 85, 60), measureDateTo: undefined };
    const r = parseMeasures(measureResponse("0", [bad, bp("2026-10-01 08:00", 120, 80, 61)]));
    expect(r.measures).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });
});

describe("toBpReading", () => {
  it("1 · 2 · 3 → 수축기 · 이완기 · 맥박 (정수)", () => {
    const [m] = parseMeasures(measureResponse("0", [bp("2026-10-01 07:00", 152, 103, 72)])).measures;
    expect(toBpReading(m)).toMatchObject({ systolic: 152, diastolic: 103, pulse: 72 });
  });

  it("수축기 · 이완기가 없으면 null", () => {
    const [m] = parseMeasures(
      measureResponse("0", [measure(kst("2026-10-01 07:00"), { "3": idx(60) })])
    ).measures;
    expect(toBpReading(m)).toBeNull();
  });

  it("맥박이 없거나 0 이면 pulse null", () => {
    const [m] = parseMeasures(
      measureResponse("0", [measure(kst("2026-10-01 07:00"), { "1": idx(120), "2": idx(80), "3": idx(0) })])
    ).measures;
    expect(toBpReading(m)?.pulse).toBeNull();
  });
});

describe("toScaleReading", () => {
  it("체중계 코드를 체성분 필드로 매핑한다", () => {
    const [m] = parseMeasures(measureResponse("1", [scale("2026-10-01 07:10", 8900)])).measures;
    expect(toScaleReading(m)).toMatchObject({
      weightKg: 89,
      bmi: 30.8,
      bodyFatPct: 27.1,
      skeletalMusclePct: 31.6,
      skeletalMuscleKg: 28.1,
      visceralFatLevel: 18,
      basalMetabolism: 1894,
      bodyAge: 56,
    });
  });

  it("체중이 없거나 0 이하면 null", () => {
    const [m] = parseMeasures(
      measureResponse("1", [measure(kst("2026-10-01 07:00"), { "257": idx(0, -2) })])
    ).measures;
    expect(toScaleReading(m)).toBeNull();
  });

  it("선택 필드가 없으면 null", () => {
    const [m] = parseMeasures(
      measureResponse("1", [measure(kst("2026-10-01 07:00"), { "257": idx(7000, -2) })])
    ).measures;
    expect(toScaleReading(m)).toMatchObject({ weightKg: 70, bmi: null, visceralFatLevel: null, bodyAge: null });
  });
});

describe("parseDevices", () => {
  const resp = {
    returnedValue: {
      syncList: [
        {
          deviceCategoryList: [
            {
              deviceCategory: "0",
              deviceModelList: [
                {
                  deviceModel: "BPM-X",
                  deviceSerialIDList: [
                    { deviceSerialID: "bp-1", userNumberInDevice: 0 },
                    { deviceSerialID: "bp-1", userNumberInDevice: 1 },
                  ],
                },
              ],
            },
            {
              deviceCategory: "1",
              deviceModelList: [
                { deviceModel: "SCALE-X", deviceSerialIDList: [{ deviceSerialID: "sc-1", userNumberInDevice: 1 }] },
              ],
            },
          ],
        },
        {
          deviceCategoryList: [
            {
              deviceCategory: "0",
              deviceModelList: [
                { deviceModel: "BPM-X", deviceSerialIDList: [{ deviceSerialID: "bp-1", userNumberInDevice: 1 }] },
              ],
            },
          ],
        },
      ],
    },
  };

  it("공용 슬롯 (user 0) 을 빼고 (serial, user) 로 중복을 제거한다", () => {
    expect(parseDevices(resp).devices).toEqual([
      { category: "0", model: "BPM-X", serial: "bp-1", user: 1 },
      { category: "1", model: "SCALE-X", serial: "sc-1", user: 1 },
    ]);
  });

  it("다음 페이지 키를 돌려준다", () => {
    const paged = { returnedValue: { ...resp.returnedValue, nextPaginationKey: "1790000000000" } };
    expect(parseDevices(paged).nextPageKey).toBe(1790000000000);
    expect(parseDevices(resp).nextPageKey).toBeNull();
  });

  it("형태가 다르면 빈 목록 + 오류 사유", () => {
    expect(parseDevices({})).toMatchObject({ devices: [], error: expect.any(String) });
  });
});
