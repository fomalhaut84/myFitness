// #552 M19-3 T3: 시험 대상 판정 · 활동 종류 불일치 · 저장 기록 복원 · 끊긴 실행 기준
import { describe, expect, it } from "vitest";
import { RUN_STALE_MS, activityMismatchError, resolveTrialTarget, staleCutoff, trialTargetOf } from "../run-plan";

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

describe("staleCutoff", () => {
  it("지금 − 10분", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(staleCutoff(now).getTime()).toBe(now.getTime() - RUN_STALE_MS);
    expect(RUN_STALE_MS).toBe(600_000);
  });
});
