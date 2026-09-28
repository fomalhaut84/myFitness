// #419: 레이스 점의 윤곽은 그 점의 연도 색 (PR #417 Codex P2 — 단일 레이스 계열이 연도 범례와 안 맞던 문제)
import { describe, expect, it } from "vitest";
import { PAST_GRAYS, yearColor } from "@/components/trends/year-colors";
import { yearSeries } from "../year-series";

const COLOR = "#f87171";
const items = [
  { id: "a", year: 2024, v: 1, race: false },
  { id: "b", year: 2024, v: 2, race: true },
  { id: "c", year: 2026, v: 3, race: true },
  { id: "d", year: 2026, v: 4, race: false },
];
const years = [2024, 2026];
const toPoint = (it: (typeof items)[number]) => ({ x: it.v, y: it.v * 10, lines: [it.id], href: `/activities/${it.id}` });

describe("yearSeries", () => {
  it("레이스 없으면 연도 계열만 · 점에 color 없음", () => {
    const s = yearSeries(items, years, 2026, toPoint, COLOR);
    expect(s.map((x) => x.id)).toEqual(["2024", "2026"]);
    expect(s[1].color).toBe(COLOR);
    expect(s[0].color).toBe(PAST_GRAYS[PAST_GRAYS.length - 1]);
    expect(s.flatMap((x) => x.points).every((p) => p.color === undefined)).toBe(true);
    expect(s.flatMap((x) => x.points)).toHaveLength(4);
  });

  it("레이스 점은 race 계열로 빠지고 · toggleId = 그 해 · color = 그 해의 연도 색 · 범례 색은 중립", () => {
    const s = yearSeries(items, years, 2026, toPoint, COLOR, (it) => it.race);
    expect(s.map((x) => x.id)).toEqual(["2024", "2026", "race"]);
    expect(s[0].points.map((p) => p.lines[0])).toEqual(["a"]);
    expect(s[1].points.map((p) => p.lines[0])).toEqual(["d"]);
    const race = s[2];
    expect(race.hollow).toBe(true);
    expect(race.color).toBe("#e5e5e5");
    expect(race.points.map((p) => [p.lines[0], p.toggleId, p.color])).toEqual([
      ["b", "2024", yearColor(2024, years, 2026, COLOR)],
      ["c", "2026", COLOR],
    ]);
  });

  it("race 판별자가 있어도 레이스가 0건이면 race 계열을 만들지 않는다", () => {
    const s = yearSeries(items, years, 2026, toPoint, COLOR, () => false);
    expect(s.map((x) => x.id)).toEqual(["2024", "2026"]);
  });
});
