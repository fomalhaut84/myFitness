// #414: 활동 타입 최근 N일 되돌아보기 — 과거 활동의 레이스 표시 · 이름 · 유형 변경이 다음 싱크에 반영되도록 (PR #412 Codex P2)
import { describe, expect, it } from "vitest";
import { ACTIVITY_RECHECK_DAYS, activityRecheckStart } from "../activity-recheck";

const kst = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`);
const today = kst("2026-09-28");

describe("activityRecheckStart", () => {
  it("cron 3일 창을 today − N 으로 넓힌다", () => {
    expect(activityRecheckStart(kst("2026-09-25"), today, 30)).toEqual(kst("2026-08-29"));
  });

  it("이미 더 이른 startDate (백필 · 초기 365일) 는 그대로", () => {
    expect(activityRecheckStart(kst("2025-09-28"), today, 30)).toEqual(kst("2025-09-28"));
    expect(activityRecheckStart(kst("2026-08-29"), today, 30)).toEqual(kst("2026-08-29"));
  });

  it("0 · 음수 · 비유한 일수는 무변경", () => {
    const start = kst("2026-09-25");
    expect(activityRecheckStart(start, today, 0)).toEqual(start);
    expect(activityRecheckStart(start, today, -5)).toEqual(start);
    expect(activityRecheckStart(start, today, Number.NaN)).toEqual(start);
  });

  it("입력 Date 를 변경하지 않는다 · 기본 창은 30일", () => {
    const start = kst("2026-09-25");
    const t = new Date(today);
    activityRecheckStart(start, t, ACTIVITY_RECHECK_DAYS);
    expect(start).toEqual(kst("2026-09-25"));
    expect(t).toEqual(today);
    expect(ACTIVITY_RECHECK_DAYS).toBe(30);
  });
});
