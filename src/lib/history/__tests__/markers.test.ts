// #396 (M15-4): 이벤트 → 차트 마커 (버킷 매핑 · 합침 · 플랜 클램프).
import { describe, expect, it } from "vitest";
import { enumerateBuckets } from "../buckets";
import { markerLabel, raceDetail, toChartMarkers, type HistoryEvent } from "../markers";

const race = (ymd: string, title = "레이스"): HistoryEvent => ({ kind: "race", ymd, endYmd: null, title, detail: null, href: `/history/${ymd.replaceAll("-", "/")}` });
const metric = (ymd: string): HistoryEvent => ({ kind: "metric", ymd, endYmd: null, title: "LTHR 157 → 160", detail: null, href: "/settings/profile" });
const plan = (ymd: string, endYmd: string): HistoryEvent => ({ kind: "plan", ymd, endYmd, title: "하프 플랜 6주", detail: "주 4회", href: "/training-plan" });
const keys = (from: string, to: string, g: "week" | "month" | "year") => enumerateBuckets(from, to, g, "2026-09-21").map((b) => b.key);

describe("markerLabel", () => {
  it("레이스 우선 · 합친 수", () => {
    expect(markerLabel([race("2024-03-31")])).toBe("R");
    expect(markerLabel([race("2024-03-31"), metric("2024-03-02")])).toBe("R+1");
    expect(markerLabel([metric("2024-03-02")])).toBe("");
    expect(markerLabel([metric("2024-03-02"), metric("2024-03-20")])).toBe("×2");
  });
});

describe("toChartMarkers", () => {
  it("월 단위: 날짜 → 월 키, 같은 달은 하나로 합친다, 범위 밖은 버린다", () => {
    const events = [race("2024-03-31"), metric("2024-03-02"), race("2024-10-20"), race("2023-11-19")];
    const { lines } = toChartMarkers(events, keys("2024-01-01", "2024-12-31", "month"), "month");
    expect(lines.map((l) => [l.key, l.label, l.race, l.events.length])).toEqual([
      ["2024-03", "R+1", true, 2],
      ["2024-10", "R", true, 1],
    ]);
  });

  it("연 단위: 레이스 3건이 한 선 (R+2) · 플랜 밴드는 만들지 않는다", () => {
    const events = [race("2023-03-26"), race("2023-10-22"), race("2023-11-19"), plan("2023-09-04", "2023-10-15")];
    const { lines, bands } = toChartMarkers(events, keys("2020-06-16", "2026-09-21", "year"), "year");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ key: "2023", label: "R+2", race: true });
    expect(bands).toEqual([]);
  });

  it("플랜 밴드: 버킷 키로 양 끝을 잡고 범위를 넘으면 첫/마지막 버킷으로 클램프", () => {
    const monthKeys = keys("2024-01-01", "2024-06-30", "month");
    const { bands } = toChartMarkers([plan("2024-02-10", "2024-03-20"), plan("2023-12-01", "2024-01-15"), plan("2024-06-20", "2024-08-01")], monthKeys, "month");
    expect(bands.map((b) => [b.fromKey, b.toKey])).toEqual([
      ["2024-02", "2024-03"],
      ["2024-01", "2024-01"],
      ["2024-06", "2024-06"],
    ]);
  });

  it("주 단위: 주 시작 (월요일) 키로 매핑 · 지표 변경만 있으면 점선 (race=false)", () => {
    const weekKeys = keys("2026-08-31", "2026-09-21", "week");
    const { lines } = toChartMarkers([metric("2026-09-10")], weekKeys, "week");
    expect(lines).toEqual([{ key: "2026-09-07", race: false, label: "", events: [metric("2026-09-10")] }]);
  });

  it("버킷이 없으면 빈 결과", () => {
    expect(toChartMarkers([race("2024-03-31")], [], "month")).toEqual({ lines: [], bands: [] });
  });
});

describe("raceDetail", () => {
  it("거리 · 페이스 (앱 공통 표기) · 시간 (1시간 넘으면 h:mm:ss)", () => {
    expect(raceDetail(21100, 289, 6098)).toBe(`21.10km · 4'49"/km · 1:41:38`);
    expect(raceDetail(10010, 270, 2703)).toBe(`10.01km · 4'30"/km · 45:03`);
    expect(raceDetail(null, null, 59)).toBe("0:59");
  });
});
