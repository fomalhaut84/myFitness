// #397 F3: 산점도 공통 필터.
import { describe, expect, it } from "vitest";
import { usableRuns } from "../filter";
import { run } from "./fixtures";

describe("usableRuns", () => {
  it("3km 미만 · 페이스 범위 밖을 빼고 건수를 센다", () => {
    const runs = [run("2024-01-01"), run("2024-01-02", { distanceM: 2_999 }), run("2024-01-03", { avgPace: 149 }), run("2024-01-04", { avgPace: 901 }), run("2024-01-05", { distanceM: 3_000, avgPace: 900 })];
    const r = usableRuns(runs);
    expect(r.kept.map((x) => x.ymd)).toEqual(["2024-01-01", "2024-01-05"]);
    expect(r.dropped).toBe(3);
    expect(r.total).toBe(5);
  });
});
