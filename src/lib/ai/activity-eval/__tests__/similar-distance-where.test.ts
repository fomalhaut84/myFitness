// 회귀: 릴리즈 PR #464 Codex P2 (#448) — 비슷한 거리 후보를 상한으로 자른 뒤 같은 코스를 빼면 목록이 빌 수 있다 → 제외는 쿼리 안에서.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/garmin/activity-splits", () => ({ fetchActivitySplits: async () => [] }));

import { similarDistanceWhere } from "../load";

describe("similarDistanceWhere", () => {
  it("자신 + 같은 코스 id 전부를 notIn 으로 · ±10% 거리 · 직전 365일", () => {
    const start = new Date("2026-04-05T12:00:00Z");
    const where = similarDistanceWhere({ id: "me", startTime: start, distance: 10_000 }, ["s1", "s2", "s3"]);
    const cond = where.AND[1] as { id: { notIn: string[] }; startTime: { gte: Date; lt: Date }; distance: { gte: number; lte: number } };
    expect(cond.id.notIn).toEqual(["me", "s1", "s2", "s3"]);
    expect(cond.distance).toEqual({ gte: 9_000, lte: 11_000 });
    expect(cond.startTime.lt).toEqual(start);
    expect(cond.startTime.gte).toEqual(new Date("2025-04-05T12:00:00Z"));
  });
});
