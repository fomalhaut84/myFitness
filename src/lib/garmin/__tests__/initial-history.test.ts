// 회귀: #514 사전 리뷰 major 1 — 배포 직후 cron 보다 "지금 싱크" · 봇 · 모닝 리포트가 먼저 돌면 OMRON 타입이
// 짧은 창으로 첫 성공을 기록해 365일 초기 로드가 영영 돌지 않았다
import { describe, expect, it } from "vitest";
import { shouldLoadInitialHistory } from "../initial-history";

describe("shouldLoadInitialHistory", () => {
  it("OMRON 은 첫 성공 전이면 bootstrapNewTypes 없이도 초기 로드", () => {
    expect(shouldLoadInitialHistory({ omron: true, hasSuccessfulSync: false })).toBe(true);
  });

  it("Garmin 은 기존대로 bootstrapNewTypes (cron) 일 때만", () => {
    expect(shouldLoadInitialHistory({ omron: false, hasSuccessfulSync: false })).toBe(false);
    expect(shouldLoadInitialHistory({ omron: false, hasSuccessfulSync: false, bootstrapNewTypes: true })).toBe(true);
  });

  it("한 번이라도 성공했으면 초기 로드 안 함", () => {
    expect(shouldLoadInitialHistory({ omron: true, hasSuccessfulSync: true, bootstrapNewTypes: true })).toBe(false);
  });
});
