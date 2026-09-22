// #396: Activity.eventType 승격 — rawData 파서.
import { describe, expect, it } from "vitest";
import { parseEventType } from "../parse-event-type";

describe("parseEventType", () => {
  it("eventType.typeKey 문자열을 그대로 돌려준다", () => {
    expect(parseEventType({ eventType: { typeKey: "race", typeId: 1 } })).toBe("race");
    expect(parseEventType({ eventType: { typeKey: "uncategorized" } })).toBe("uncategorized");
  });

  it("누락 · 비객체 · 비문자열 · 빈 문자열은 null", () => {
    expect(parseEventType(null)).toBeNull();
    expect(parseEventType(undefined)).toBeNull();
    expect(parseEventType("race")).toBeNull();
    expect(parseEventType({})).toBeNull();
    expect(parseEventType({ eventType: null })).toBeNull();
    expect(parseEventType({ eventType: "race" })).toBeNull();
    expect(parseEventType({ eventType: { typeKey: 7 } })).toBeNull();
    expect(parseEventType({ eventType: { typeKey: "   " } })).toBeNull();
  });

  it("앞뒤 공백은 잘라낸다", () => {
    expect(parseEventType({ eventType: { typeKey: " race " } })).toBe("race");
  });
});
