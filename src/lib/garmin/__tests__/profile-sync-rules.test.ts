// 회귀: #505 — "source null + 값 있음 = manual 간주" 규칙 때문에 maxHR · LTHR 이 한 번도 자동 싱크되지 않았다
import { describe, expect, it } from "vitest";
import { canAutoUpdate } from "../profile-values";

describe("canAutoUpdate", () => {
  it("source 가 null 이면 값이 있어도 Garmin 이 갱신한다", () => {
    expect(canAutoUpdate(null)).toBe(true);
  });

  it("garmin 출처는 갱신한다", () => {
    expect(canAutoUpdate("garmin")).toBe(true);
  });

  it("사용자가 명시적으로 입력한 manual 만 보호한다", () => {
    expect(canAutoUpdate("manual")).toBe(false);
  });
});
