// 회귀: PR #456 Codex P2 — type="running" 이 contains 라 virtual_run · obstacle_run 이 주간 창에서 빠졌다.
import { describe, expect, it } from "vitest";
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";
import { activityTypeWhere } from "../activity-filter";

describe("activityTypeWhere", () => {
  it('"running" 은 앱 공용 러닝 판정 (통합 셋 + contains) 을 쓴다', () => {
    const where = activityTypeWhere("running");
    expect(where).toBe(RUNNING_ACTIVITY_WHERE);
    const inList = (RUNNING_ACTIVITY_WHERE.OR[0] as { activityType: { in: string[] } }).activityType.in;
    expect(inList).toContain("virtual_run");
    expect(inList).toContain("obstacle_run");
  });

  it("하위 타입 · 다른 종목은 부분 일치 그대로 · 생략/공백은 필터 없음", () => {
    expect(activityTypeWhere("trail_running")).toEqual({ activityType: { contains: "trail_running" } });
    expect(activityTypeWhere("cycling")).toEqual({ activityType: { contains: "cycling" } });
    expect(activityTypeWhere(undefined)).toBeUndefined();
    expect(activityTypeWhere("  ")).toBeUndefined();
  });
});
