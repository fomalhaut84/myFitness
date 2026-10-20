// #570: 강도 컬럼 — 기준 혼재 방지 · 바뀐 행만 갱신
import { describe, expect, it } from "vitest";
import { computeIntensityFromRawData } from "../intensity";
import { EMPTY_INTENSITY_COLUMNS, sameIntensityColumns, shouldClearOnMissing, toIntensityColumns } from "../intensity-columns";

const RAW = { hrTimeInZone_1: 600, hrTimeInZone_2: 2400, hrTimeInZone_3: 300, hrTimeInZone_4: 0, hrTimeInZone_5: 0 };

describe("intensity-columns", () => {
  it("계산 결과 → 기준 포함 컬럼, null → 전부 비움", () => {
    const cols = toIntensityColumns(computeIntensityFromRawData({ rawData: RAW }));
    expect(cols.intensityBasis).toBe("hr");
    expect(toIntensityColumns(null)).toEqual(EMPTY_INTENSITY_COLUMNS);
  });

  it("파워 기준만 데이터 없을 때 비운다", () => {
    expect(shouldClearOnMissing("power")).toBe(true);
    expect(shouldClearOnMissing("hr")).toBe(false);
    expect(shouldClearOnMissing("auto")).toBe(false);
  });

  it("같은 값이면 갱신하지 않고, 기준만 달라도 갱신", () => {
    const cols = toIntensityColumns(computeIntensityFromRawData({ rawData: RAW }));
    const stored = { ...cols, zoneDistribution: { ...cols.zoneDistribution } };
    expect(sameIntensityColumns(stored, cols)).toBe(true);
    expect(sameIntensityColumns({ ...stored, intensityBasis: null }, cols)).toBe(false);
    expect(sameIntensityColumns({ ...stored, zoneDistribution: null }, cols)).toBe(false);
    expect(sameIntensityColumns({ ...EMPTY_INTENSITY_COLUMNS }, EMPTY_INTENSITY_COLUMNS)).toBe(true);
  });
});
