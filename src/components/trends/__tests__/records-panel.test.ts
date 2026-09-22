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
