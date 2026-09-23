// #396 회귀: 사전 리뷰 major 1 — 빈 버킷 문구가 하한만 말해 "45km 최장 거리" 와 같은 장부에서 모순됐다
import { describe, expect, it } from "vitest";
import { buildRecordRows } from "../RecordsPanel";
import type { PersonalRecords } from "@/lib/history/records";

const ultra = { id: "u", ymd: "2024-05-05", name: "울트라", distanceM: 45000, durationSec: 5 * 3600, avgPace: 400, race: true };
const records: PersonalRecords = {
  byBucket: { "5k": null, "10k": null, HM: null, FM: null },
  longest: ultra,
  bestMonth: null,
  bestVo2max: null,
  lowestRestingHR: null,
  bestHrr2: null,
  races: [],
};

describe("buildRecordRows", () => {
  it("풀 기록 없음 + 45km 최장 거리가 모순되지 않는다 (구간 문구)", () => {
    const rows = buildRecordRows(records);
    const fm = rows.find((r) => r.key === "FM");
    expect(fm?.value).toBeNull();
    expect(fm?.empty).toBe("40~44km 구간 기록이 없습니다");
    expect(rows.find((r) => r.key === "longest")).toMatchObject({ value: "45.00", unit: "km", race: true, date: "2024-05-05", href: "/history/2024/05/05" });
  });
});

// #442 (M17-3): 개인 기록 "가장 큰 2분 HRR"
describe("buildRecordRows — bestHrr2", () => {
  it("행이 있고, 값은 bpm · 날짜 링크는 hrr2 지표 쿼리", () => {
    const rows = buildRecordRows({ ...records, bestHrr2: { value: 41, ymd: "2026-05-11" } });
    expect(rows.find((r) => r.key === "hrr2")).toMatchObject({ label: "가장 큰 2분 HRR", value: "41", unit: "bpm", date: "2026-05-11", href: "/history/2026/05/11?metric=hrr2" });
  });

  it("없으면 빈 상태 문구", () => {
    const row = buildRecordRows(records).find((r) => r.key === "hrr2");
    expect(row?.value).toBeNull();
    expect(row?.empty).toBe("종료 후 심박이 계산된 러닝이 없습니다");
  });
});
