import { describe, expect, it } from "vitest";
import { garminMayOverwrite, omronWriteAction } from "../write-policy";

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
