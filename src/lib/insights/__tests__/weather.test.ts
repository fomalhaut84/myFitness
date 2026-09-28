// #397 B: 기온 vs 페이스.
import { describe, expect, it } from "vitest";
import { heatPenalty, humidityLevel, paceByTempBin, tempBinIndex, weatherPoints } from "../weather";
import { run } from "./fixtures";

describe("humidityLevel · tempBinIndex", () => {
  it("습도 경계 50 · 75 · null → 중간", () => {
    expect(humidityLevel(49)).toBe(0);
    expect(humidityLevel(50)).toBe(1);
    expect(humidityLevel(75)).toBe(1);
    expect(humidityLevel(76)).toBe(2);
    expect(humidityLevel(null)).toBe(1);
  });

  it("온도 구간 — 음수는 첫 칸, 30 이상은 마지막 칸, 경계는 위 칸", () => {
    expect(tempBinIndex(-3)).toBe(0);
    expect(tempBinIndex(4.9)).toBe(0);
    expect(tempBinIndex(5)).toBe(1);
    expect(tempBinIndex(29.9)).toBe(5);
    expect(tempBinIndex(30)).toBe(6);
    expect(tempBinIndex(38)).toBe(6);
  });
});

describe("paceByTempBin · heatPenalty", () => {
  it("구간별 중앙값 (5건 미만 null) · 30 이상 vs 10~15 차이", () => {
    const mild = [300, 310, 320, 330, 340].map((p, i) => run(`2024-04-0${i + 1}`, { tempC: 12, avgPace: p }));
    const hot = [330, 340, 350, 360, 900].map((p, i) => run(`2024-08-0${i + 1}`, { tempC: 33, avgPace: p }));
    const bins = paceByTempBin(weatherPoints([...mild, ...hot, run("2024-01-01", { tempC: 2 }), run("2024-01-02", { tempC: null })]));
    expect(bins.map((b) => b.label)).toEqual(["< 5", "5~10", "10~15", "15~20", "20~25", "25~30", "≥ 30"]);
    expect(bins[0]).toMatchObject({ n: 1, medianPace: null });
    expect(bins[2]).toMatchObject({ n: 5, medianPace: 320 });
    expect(bins[6]).toMatchObject({ n: 5, medianPace: 350 }); // 900 이상치가 평균이면 끌어올렸을 것
    expect(heatPenalty(bins)).toMatchObject({ deltaSec: 30 });
    expect(heatPenalty(bins.slice(0, 3))).toBeNull();
  });
});
