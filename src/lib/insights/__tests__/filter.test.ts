// #397 F3: 산점도 공통 필터.
import { describe, expect, it } from "vitest";
import { describeDropped, usableRuns } from "../filter";
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

// 회귀: PR #417 Codex P2 — 거리 · 페이스 없는 러닝은 조회가 아니라 여기서만 빠진다 (존 패널은 전체 러닝)
describe("usableRuns · 거리 없는 러닝", () => {
  it("null 거리 · 페이스는 산점도에서 제외되고 dropped 로 센다", () => {
    const r = usableRuns([run("2024-01-01", { distanceM: null, avgPace: null }), run("2024-01-02")]);
    expect(r.kept.map((x) => x.ymd)).toEqual(["2024-01-02"]);
    expect(r.dropped).toBe(1);
  });
});

// #419: 캡션의 제외 사유를 분리해 센다 (PR #417 Codex P2 — 트레드밀이 "페이스 범위 밖" 으로 읽히던 문구)
describe("usableRuns · droppedBy", () => {
  it("사유별 건수 — 거리 없음 · 3km 미만 · 페이스 범위 밖 · 합계는 dropped 와 같다", () => {
    const r = usableRuns([
      run("2024-01-01"),
      run("2024-01-02", { distanceM: null, avgPace: null }),
      run("2024-01-03", { distanceM: 2_999 }),
      run("2024-01-04", { distanceM: 1_000 }),
      run("2024-01-05", { avgPace: 149 }),
    ]);
    expect(r.droppedBy).toEqual({ noDistance: 1, tooShort: 2, paceOut: 1 });
    expect(r.dropped).toBe(4);
  });

  it("한 건은 한 사유 — 거리 없음 > 3km 미만 > 페이스 범위 밖", () => {
    expect(usableRuns([run("2024-01-01", { distanceM: null, avgPace: 5_000 })]).droppedBy).toEqual({ noDistance: 1, tooShort: 0, paceOut: 0 });
    expect(usableRuns([run("2024-01-01", { distanceM: 500, avgPace: 5_000 })]).droppedBy).toEqual({ noDistance: 0, tooShort: 1, paceOut: 0 });
    expect(usableRuns([run("2024-01-01", { distanceM: 5_000, avgPace: null })]).droppedBy).toEqual({ noDistance: 1, tooShort: 0, paceOut: 0 });
  });
});

describe("describeDropped", () => {
  it("0건인 사유는 생략 · 전부 0 이면 빈 문자열 · 천 단위 구분", () => {
    expect(describeDropped({ noDistance: 3, tooShort: 1200, paceOut: 0 })).toBe("거리 없음 3건 · 3km 미만 1,200건");
    expect(describeDropped({ noDistance: 0, tooShort: 0, paceOut: 2 })).toBe("페이스 범위 밖 2건");
    expect(describeDropped({ noDistance: 0, tooShort: 0, paceOut: 0 })).toBe("");
  });
});
