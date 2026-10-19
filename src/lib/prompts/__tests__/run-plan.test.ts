// #552 M19-3 T3: 시험 대상 판정 · 활동 종류 불일치 · 저장 기록 복원 · 끊긴 실행 기준
import { describe, expect, it } from "vitest";
import { RUN_STALE_MARGIN_MS, activityMismatchError, quotaText, trialMaxMs, resolveTrialTarget, staleCutoff, trialTargetOf } from "../run-plan";

describe("resolveTrialTarget", () => {
  it("리포트 키는 자기 리포트 — 요청의 target 은 무시", () => {
    expect(resolveTrialTarget("evening_report", { target: "activity", activityId: "a1" })).toEqual({ ok: true, target: { kind: "report", key: "evening_report" } });
    expect(resolveTrialTarget("weekly_report", {})).toEqual({ ok: true, target: { kind: "report", key: "weekly_report" } });
  });

  it("평가 키는 활동 필수", () => {
    expect(resolveTrialTarget("activity_eval", {})).toEqual({ ok: false, error: "시험할 활동을 고르세요" });
    expect(resolveTrialTarget("activity_eval_brief", { activityId: "  " }).ok).toBe(false);
    expect(resolveTrialTarget("activity_eval", { activityId: " a1 " })).toEqual({ ok: true, target: { kind: "activity", activityId: "a1" } });
  });

  it("시스템 초안 — 기본 모닝 리포트 · 다른 리포트 · 활동", () => {
    expect(resolveTrialTarget("system", {})).toEqual({ ok: true, target: { kind: "report", key: "morning_report" } });
    expect(resolveTrialTarget("system", { target: "weekly_report" })).toEqual({ ok: true, target: { kind: "report", key: "weekly_report" } });
    expect(resolveTrialTarget("system", { target: "activity" }).ok).toBe(false);
    expect(resolveTrialTarget("system", { target: "activity", activityId: "a1" })).toEqual({ ok: true, target: { kind: "activity", activityId: "a1" } });
  });
});

describe("activityMismatchError", () => {
  it("러닝 평가 초안은 러닝 활동만", () => {
    expect(activityMismatchError("activity_eval", "trail_running")).toBeNull();
    expect(activityMismatchError("activity_eval", "strength_training")).toMatch(/러닝 활동으로만/);
  });

  it("기타 운동 평가 초안은 러닝이 아닌 활동만", () => {
    expect(activityMismatchError("activity_eval_brief", "cycling")).toBeNull();
    expect(activityMismatchError("activity_eval_brief", "running")).toMatch(/러닝이 아닌/);
  });

  it("시스템 초안은 어떤 활동이든", () => {
    expect(activityMismatchError("system", "running")).toBeNull();
    expect(activityMismatchError("system", "yoga")).toBeNull();
  });
});

describe("trialTargetOf", () => {
  it("저장된 시험 기록 → 대상", () => {
    expect(trialTargetOf({ kind: "trial", targetKind: "report", targetRef: "morning_report" })).toEqual({ kind: "report", key: "morning_report" });
    expect(trialTargetOf({ kind: "trial", targetKind: "activity", targetRef: "a1" })).toEqual({ kind: "activity", activityId: "a1" });
  });

  it("개선안 · 모르는 리포트 키 · 대상 없음은 null", () => {
    expect(trialTargetOf({ kind: "suggest", targetKind: null, targetRef: null })).toBeNull();
    expect(trialTargetOf({ kind: "trial", targetKind: "report", targetRef: "general" })).toBeNull();
    expect(trialTargetOf({ kind: "trial", targetKind: "activity", targetRef: null })).toBeNull();
  });
});

// 회귀: M19-3 사전 리뷰 info 1 — 고정 10분이면 재시도 env 를 늘렸을 때 살아 있는 실행을 끊는다
describe("staleCutoff", () => {
  it("지금 − (실행 최대 소요 + 여유)", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const eighteenMin = 18 * 60_000; // 180초 × (1 + 재시도 5)
    expect(staleCutoff(eighteenMin, now).getTime()).toBe(now.getTime() - eighteenMin - RUN_STALE_MARGIN_MS);
  });
});

// 회귀: #562 (릴리즈 PR #561 Codex P2) — 리포트 시험은 재시도로 3분을 넘을 수 있다
describe("시험 실행 상한 안내", () => {
  const limits = { reportMs: 540_000, activityMs: 180_000 };
  it("리포트는 재시도 포함 상한 · 운동 평가는 1회", () => {
    expect(quotaText(trialMaxMs("report", limits))).toBe("CLI 쿼터 사용 · 최대 9분");
    expect(quotaText(trialMaxMs("activity", limits))).toBe("CLI 쿼터 사용 · 최대 3분");
  });
  it("분 단위 올림", () => {
    expect(quotaText(61_000)).toBe("CLI 쿼터 사용 · 최대 2분");
  });
});
