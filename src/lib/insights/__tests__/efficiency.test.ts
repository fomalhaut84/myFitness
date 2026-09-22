// #397 A: 효율 — 기준 구간 연도별 평균 심박.
import { describe, expect, it } from "vitest";
import { efficiencyByYear, efficiencyDelta, efficiencyPoints } from "../efficiency";
import { run } from "./fixtures";

describe("efficiencyPoints", () => {
  it("심박 없는 러닝은 빠지고 레이스 플래그가 전달된다", () => {
    const pts = efficiencyPoints([run("2024-01-01", { avgHR: null }), run("2024-01-02", { avgHR: 0 }), run("2024-01-03", { race: true })]);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ ymd: "2024-01-03", race: true, hr: 150, pace: 310 });
  });
});

describe("efficiencyByYear", () => {
  const five = (year: number, hr: number, pace = 310) => Array.from({ length: 5 }, (_, i) => run(`${year}-03-${String(i + 1).padStart(2, "0")}`, { avgHR: hr, avgPace: pace }));

  it("구간 [300, 330) 경계 — 300 포함 · 330 제외 · 5건 미만 해는 null · 연도 오름차순", () => {
    const runs = [...five(2022, 160, 300), ...five(2021, 150), ...five(2023, 140, 330), run("2024-01-01", { avgHR: 130 })];
    const rows = efficiencyByYear(efficiencyPoints(runs));
    expect(rows.map((r) => [r.year, r.n, r.avgHr])).toEqual([
      [2021, 5, 150],
      [2022, 5, 160],
      [2024, 1, null],
    ]);
  });

  it("years 를 주면 구간에 러닝이 없는 해도 열로 (n=0 · null)", () => {
    const rows = efficiencyByYear(efficiencyPoints(five(2022, 160)), undefined, [2021, 2022, 2023]);
    expect(rows.map((r) => [r.year, r.n, r.avgHr])).toEqual([
      [2021, 0, null],
      [2022, 5, 160],
      [2023, 0, null],
    ]);
  });

  it("delta = 마지막 해 − 평균이 있는 첫 해", () => {
    const rows = efficiencyByYear(efficiencyPoints([...five(2021, 158), run("2022-01-01"), ...five(2026, 149)]));
    expect(efficiencyDelta(rows)).toEqual({ firstYear: 2021, lastYear: 2026, from: 158, to: 149, delta: -9 });
    expect(efficiencyDelta(rows.slice(0, 1))).toBeNull();
  });
});

// 회귀: 사전 리뷰 major 1 — 올해 구간 러닝이 5건 미만이면 마지막 유효 해는 올해가 아니다. 화면은 lastYear 를 읽어야 한다
describe("efficiencyDelta · 올해가 유효하지 않을 때", () => {
  it("lastYear = 평균이 있는 마지막 해 (올해 n=3 → 지난해)", () => {
    const five = (year: number, hr: number) => Array.from({ length: 5 }, (_, i) => run(`${year}-03-0${i + 1}`, { avgHR: hr }));
    const thisYear = [run("2026-01-05", { avgHR: 140 }), run("2026-02-05", { avgHR: 141 }), run("2026-03-05", { avgHR: 142 })];
    const rows = efficiencyByYear(efficiencyPoints([...five(2021, 158), ...five(2025, 150), ...thisYear]), undefined, [2021, 2025, 2026]);
    expect(rows[2]).toEqual({ year: 2026, n: 3, avgHr: null });
    expect(efficiencyDelta(rows)).toEqual({ firstYear: 2021, lastYear: 2025, from: 158, to: 150, delta: -8 });
  });
});
