import { describe, expect, it } from "vitest";
import { GARMIN_PROTECTED_SOURCES, garminArchive, garminMayOverwrite, omronWriteAction } from "../write-policy";

describe("omronWriteAction — OMRON 우선 · manual 보호 (2026-10-15 사용자 결정)", () => {
  it("행이 없으면 생성", () => {
    expect(omronWriteAction(null)).toBe("create");
  });

  it("Garmin 행은 OMRON 으로 교체 (Garmin 원본 보존)", () => {
    expect(omronWriteAction("garmin")).toBe("replace_garmin");
  });

  it("OMRON 행은 갱신", () => {
    expect(omronWriteAction("omron")).toBe("update");
  });

  it("수동 입력은 건드리지 않는다", () => {
    expect(omronWriteAction("manual")).toBe("skip");
  });

  it("알 수 없는 출처도 건드리지 않는다", () => {
    expect(omronWriteAction("other")).toBe("skip");
  });
});

describe("garminMayOverwrite", () => {
  it("garmin 행만 Garmin 싱크가 덮는다", () => {
    expect(garminMayOverwrite("garmin")).toBe(true);
    expect(garminMayOverwrite("omron")).toBe(false);
    expect(garminMayOverwrite("manual")).toBe(false);
  });
});

// 사전 리뷰 info 2 · 3: 보호 판정과 notIn 상수가 어긋나지 않게 · Garmin 원본 보존 조립
describe("GARMIN_PROTECTED_SOURCES 와 garminMayOverwrite 일치", () => {
  it.each(["manual", "omron"])("%s 는 보호 상수에 있고 덮지 않는다", (source) => {
    expect(GARMIN_PROTECTED_SOURCES).toContain(source);
    expect(garminMayOverwrite(source)).toBe(false);
  });
});

describe("garminArchive — 덮어쓴 Garmin 원본 (rawData.replacedGarmin)", () => {
  const snapshot = { weight: 89.1, rawData: { from: "garmin" } };

  it("Garmin 행을 교체할 때는 기존 값 스냅샷을 보존한다", () => {
    expect(garminArchive("replace_garmin", { anything: 1 }, snapshot)).toEqual(snapshot);
  });

  it("OMRON 행 갱신은 이전에 보존한 Garmin 원본을 유지한다", () => {
    expect(garminArchive("update", { provider: "omron", replacedGarmin: { old: true } }, snapshot)).toEqual({ old: true });
  });

  it("보존할 Garmin 원본이 없으면 undefined", () => {
    expect(garminArchive("update", { provider: "omron" }, snapshot)).toBeUndefined();
    expect(garminArchive("create", null, snapshot)).toBeUndefined();
    expect(garminArchive("update", { replacedGarmin: null }, snapshot)).toBeUndefined();
  });
});
