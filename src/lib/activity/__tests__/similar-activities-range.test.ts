// 회귀: PR #446 Codex P2 (#448) — 같은 코스 "이전 기록" 을 후처리로 거르면 이후 기록 30건 이상인 코스에서 기준선이 빈다 → DB 에서 before 로 자른다.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { candidateTimeRange } from "../similar-activities";

const at = (iso: string) => new Date(iso);

describe("candidateTimeRange", () => {
  it("before 없음 — 활동 기준 ±2년 창 (양끝 포함)", () => {
    const r = candidateTimeRange(at("2026-04-05T12:00:00Z"));
    expect(r).toEqual({ gte: at("2024-04-05T12:00:00Z"), lte: at("2028-04-05T12:00:00Z") });
  });

  it("before 있음 — 창 끝을 before (exclusive) 로 자른다", () => {
    const start = at("2026-04-05T12:00:00Z");
    const r = candidateTimeRange(start, start);
    expect(r).toEqual({ gte: at("2024-04-05T12:00:00Z"), lt: start });
  });

  it("before 가 창 끝보다 뒤면 창 끝이 남는다", () => {
    const start = at("2026-04-05T12:00:00Z");
    const r = candidateTimeRange(start, at("2030-01-01T00:00:00Z"));
    expect(r).toEqual({ gte: at("2024-04-05T12:00:00Z"), lte: at("2028-04-05T12:00:00Z") });
  });
});
