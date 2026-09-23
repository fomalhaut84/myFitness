// #418: 러닝 종료 후 심박 회복 (HRR). 픽스처는 로컬 실측 2026-04-05 트랙 러닝 (종료 22:44:39 KST) 의 하루치 심박 시계열 일부.
import { describe, expect, it } from "vitest";
import {
  RECOVERY_OFFSETS_MIN,
  RECOVERY_PRE_WINDOW_MS,
  RECOVERY_WINDOW_MS,
  SAMPLE_TOLERANCE_MS,
  activityEndMs,
  nearestSample,
  parseHeartRateValues,
  recoveryCurve,
  recoveryDayKeys,
} from "../recovery";

const kst = (hhmmss: string, ymd = "2026-04-05") => Date.parse(`${ymd}T${hhmmss}+09:00`);
const MIN = 60_000;

/** 22:38 ~ 23:02, 2분 격자 (실측값) */
const SERIES: Array<[number, number | null]> = [
  [kst("22:38:00"), 123],
  [kst("22:40:00"), 124],
  [kst("22:42:00"), 125],
  [kst("22:44:00"), 125],
  [kst("22:46:00"), 109],
  [kst("22:48:00"), 92],
  [kst("22:50:00"), 82],
  [kst("22:52:00"), 81],
  [kst("22:54:00"), 77],
  [kst("22:56:00"), 76],
  [kst("22:58:00"), 77],
  [kst("23:00:00"), 74],
  [kst("23:02:00"), 72],
];
const END = kst("22:44:39");

const bpms = (series: Array<[number, number | null]>, endMs = END) => recoveryCurve(series, endMs).points.map((p) => p.bpm);

describe("nearestSample", () => {
  it("허용 오차 안의 가장 가까운 샘플 — 60초는 채택, 61초는 결측", () => {
    expect(nearestSample(SERIES, kst("22:44:39"))).toEqual({ epochMs: kst("22:44:00"), bpm: 125 });
    expect(nearestSample([[kst("22:44:00"), 125]], kst("22:45:00"))).toEqual({ epochMs: kst("22:44:00"), bpm: 125 });
    expect(nearestSample([[kst("22:44:00"), 125]], kst("22:45:01"))).toBeNull();
  });

  it("동거리면 이른 샘플 · 정렬을 가정하지 않는다", () => {
    const unsorted: Array<[number, number | null]> = [[kst("22:46:00"), 109], [kst("22:44:00"), 125]];
    expect(nearestSample(unsorted, kst("22:45:00"))?.bpm).toBe(125);
  });

  it("가장 가까운 샘플이 null · 0 이하면 결측 (옆의 유효 샘플로 대체하지 않는다)", () => {
    expect(nearestSample([[kst("22:44:00"), null], [kst("22:45:30"), 120]], kst("22:44:20"))).toBeNull();
    expect(nearestSample([[kst("22:44:00"), 0]], kst("22:44:00"))).toBeNull();
    expect(nearestSample([[kst("22:44:00"), -5]], kst("22:44:00"))).toBeNull();
  });

  it("허용 오차 인자 · 빈 시계열", () => {
    expect(nearestSample(SERIES, kst("22:44:39"), 30_000)).toBeNull();
    expect(nearestSample([], kst("22:44:39"))).toBeNull();
    expect(SAMPLE_TOLERANCE_MS).toBe(MIN);
  });
});

describe("recoveryCurve", () => {
  it("실측: 종료 22:44:39 → −4 … +10 · hrr2 16 · drop10 48", () => {
    const curve = recoveryCurve(SERIES, END);
    expect(RECOVERY_OFFSETS_MIN).toEqual([-4, -2, 0, 2, 4, 6, 10]);
    expect(curve.points.map((p) => [p.offsetMin, p.bpm])).toEqual([
      [-4, 124],
      [-2, 125],
      [0, 125],
      [2, 109],
      [4, 92],
      [6, 82],
      [10, 77],
    ]);
    expect(curve.points[0].sampledAtMs).toBe(kst("22:40:00"));
    expect(curve.hrr2).toBe(16);
    expect(curve.drop10).toBe(48);
    expect(curve.postSamples).toBe(5);
    expect(curve.endMs).toBe(END);
  });

  it("null 샘플: 그 점만 결측, 0 · +2 중 하나라도 결측이면 hrr2 null", () => {
    const at4Null = SERIES.map(([t, v]) => [t, t === kst("22:48:00") ? null : v] as [number, number | null]);
    expect(bpms(at4Null)).toEqual([124, 125, 125, 109, null, 82, 77]);
    expect(recoveryCurve(at4Null, END).hrr2).toBe(16);

    const endNull = SERIES.map(([t, v]) => [t, t === kst("22:44:00") ? null : v] as [number, number | null]);
    const c = recoveryCurve(endNull, END);
    expect(c.points[2].bpm).toBeNull();
    expect(c.hrr2).toBeNull();
    expect(c.drop10).toBeNull();
    expect(c.postSamples).toBe(4);
  });

  it("워치 벗음: 종료 후 전부 null → postSamples 0, 종료 전 점은 남는다", () => {
    const off = SERIES.map(([t, v]) => [t, t >= kst("22:44:00") ? null : v] as [number, number | null]);
    const c = recoveryCurve(off, END);
    expect(c.points.map((p) => p.bpm)).toEqual([124, 125, null, null, null, null, null]);
    expect(c.postSamples).toBe(0);
    expect(c.hrr2).toBeNull();
  });

  it("음수 HRR (종료 뒤 심박 상승) 은 부호 그대로", () => {
    const rise = SERIES.map(([t, v]) => [t, t === kst("22:46:00") ? 139 : v] as [number, number | null]);
    expect(recoveryCurve(rise, END).hrr2).toBe(-14);
  });

  it("종료 후 시계열이 없으면 (하루 끝) 그 점들은 결측", () => {
    expect(bpms(SERIES.slice(0, 5))).toEqual([124, 125, 125, 109, null, null, null]);
  });

  // 회귀: 사전 리뷰 major 1 — 00:02 종료의 −4 · −2 · 0 분은 전날 시계열에서 잡혀야 한다
  it("자정 직후 종료: 종료 전 점은 전날 샘플, 종료 후 점은 당일 샘플", () => {
    const end = kst("00:02:20", "2026-04-06");
    const merged: Array<[number, number | null]> = [
      [kst("23:58:00"), 141],
      [kst("00:00:00", "2026-04-06"), 140],
      [kst("00:02:00", "2026-04-06"), 138],
      [kst("00:04:00", "2026-04-06"), 120],
      [kst("00:06:00", "2026-04-06"), 105],
      [kst("00:08:00", "2026-04-06"), 96],
      [kst("00:12:00", "2026-04-06"), 88],
    ];
    const c = recoveryCurve(merged, end);
    expect(c.points.map((p) => p.bpm)).toEqual([141, 140, 138, 120, 105, 96, 88]);
    expect(c.hrr2).toBe(18);
  });

  it("자정 경계: 두 날의 시계열을 합친 배열에서 +10 분이 다음 날 샘플에 잡힌다", () => {
    const end = kst("23:55:30");
    const merged: Array<[number, number | null]> = [
      [kst("23:52:00"), 150],
      [kst("23:54:00"), 152],
      [kst("23:56:00"), 148],
      [kst("23:58:00"), 130],
      [kst("00:00:00", "2026-04-06"), 118],
      [kst("00:02:00", "2026-04-06"), 105],
      [kst("00:06:00", "2026-04-06"), 92],
    ];
    expect(bpms(merged, end)).toEqual([150, 152, 148, 130, 118, 105, 92]);
  });
});

describe("recoveryDayKeys", () => {
  it("종료 + 11분이 같은 날이면 하루, 넘어가면 이틀 (KST)", () => {
    expect(RECOVERY_WINDOW_MS).toBe(11 * MIN);
    expect(recoveryDayKeys(END)).toEqual(["2026-04-05"]);
    expect(recoveryDayKeys(kst("23:48:59"))).toEqual(["2026-04-05"]);
    expect(recoveryDayKeys(kst("23:49:00"))).toEqual(["2026-04-05", "2026-04-06"]);
  });

  // 회귀: 사전 리뷰 major 1 — 자정 직후 종료는 −4 · −2 분이 전날이라 전날 레코드도 읽어야 한다
  it("종료 − 5분이 전날이면 전날 + 종료일 (종료일이 뒤)", () => {
    expect(RECOVERY_PRE_WINDOW_MS).toBe(5 * MIN);
    expect(recoveryDayKeys(kst("00:04:59", "2026-04-06"))).toEqual(["2026-04-05", "2026-04-06"]);
    expect(recoveryDayKeys(kst("00:05:00", "2026-04-06"))).toEqual(["2026-04-06"]);
    expect(recoveryDayKeys(kst("00:00:00", "2026-04-06"))).toEqual(["2026-04-05", "2026-04-06"]);
  });
});

describe("parseHeartRateValues", () => {
  it("배열이 아니면 빈 배열, 형태가 맞지 않는 원소는 버린다", () => {
    expect(parseHeartRateValues(undefined)).toEqual([]);
    expect(parseHeartRateValues(null)).toEqual([]);
    expect(parseHeartRateValues("[[1,2]]")).toEqual([]);
    expect(parseHeartRateValues({ heartRateValues: [[1, 2]] })).toEqual([]);
    expect(
      parseHeartRateValues([
        [1_000, 60],
        [2_000, null],
        [3_000, "70"],
        ["4000", 80],
        [5_000],
        [6_000, 90, "extra"],
        null,
        [Number.NaN, 100],
        [7_000, Number.POSITIVE_INFINITY],
      ]),
    ).toEqual([
      [1_000, 60],
      [2_000, null],
    ]);
  });
});

describe("activityEndMs", () => {
  const start = new Date("2026-04-05T12:51:14.000Z");

  it("rawData.elapsedDuration (벽시계) 우선, 없거나 이상하면 duration", () => {
    expect(activityEndMs(start, 3205, { elapsedDuration: 3400.5 })).toBe(start.getTime() + 3400.5 * 1000);
    expect(activityEndMs(start, 3205, { elapsedDuration: 0 })).toBe(start.getTime() + 3205 * 1000);
    expect(activityEndMs(start, 3205, { elapsedDuration: -3 })).toBe(start.getTime() + 3205 * 1000);
    expect(activityEndMs(start, 3205, { elapsedDuration: "3400" })).toBe(start.getTime() + 3205 * 1000);
    expect(activityEndMs(start, 3205, { elapsedDuration: Number.NaN })).toBe(start.getTime() + 3205 * 1000);
    expect(activityEndMs(start, 3205, {})).toBe(start.getTime() + 3205 * 1000);
    expect(activityEndMs(start, 3205, null)).toBe(start.getTime() + 3205 * 1000);
    expect(activityEndMs(start, 3205, "x")).toBe(start.getTime() + 3205 * 1000);
  });

  it("elapsedDuration 이 duration 보다 짧아도 (일시정지 보정값 이상) elapsed 를 쓴다 — 벽시계가 정본", () => {
    expect(activityEndMs(start, 3205, { elapsedDuration: 3000 })).toBe(start.getTime() + 3000 * 1000);
  });
});
