// #552 M19-3 T2: 실행 중 1건 (partial unique 위반 → 409) · 실패 시 failed + 메시지 · 성공 시 done
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  promptRun: { create: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/ai/claude-advisor", () => ({ getAskAdvisorMaxTotalBudgetMs: () => 540_000 }));

import { startRun, sweepRunsOnBoot } from "../runs";
import { PromptActionError } from "../versions";

/** 백그라운드 완료 (finishRun) 의 기록 — 첫 updateMany 는 시작 전 오래된 실행 정리 */
const finishCalls = () => db.promptRun.updateMany.mock.calls.filter(([arg]) => arg.where.id === "run1");

async function settled(): Promise<void> {
  await vi.waitFor(() => expect(finishCalls().length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.promptRun.updateMany.mockResolvedValue({ count: 0 });
  db.promptRun.create.mockResolvedValue({ id: "run1" });
});

describe("startRun", () => {
  it("이미 실행 중 (P2002) 이면 409 — work 는 돌지 않는다", async () => {
    db.promptRun.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const work = vi.fn(async () => "x");
    const err = await startRun({ kind: "suggest", versionId: "v1" }, work).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PromptActionError);
    expect((err as PromptActionError).status).toBe(409);
    expect(work).not.toHaveBeenCalled();
  });

  it("시작 전에 끊긴 running 을 failed 로 정리 — 기준은 어드바이저 최대 소요 + 여유", async () => {
    const before = Date.now();
    await startRun({ kind: "suggest", versionId: "v1" }, async () => "ok");
    const sweep = db.promptRun.updateMany.mock.calls[0][0];
    expect(sweep.where.status).toBe("running");
    expect(before - sweep.where.startedAt.lt.getTime()).toBeGreaterThanOrEqual(540_000);
  });

  it("work 성공 → done + 응답", async () => {
    const run = await startRun({ kind: "trial", versionId: "v1", targetKind: "report", targetRef: "morning_report" }, async () => "결과");
    expect(run).toEqual({ id: "run1" });
    await settled();
    // 회귀: M19-3 사전 리뷰 info 2 — running 일 때만 바꾼다 (정리가 먼저 failed 로 바꿨으면 뒤집지 않음)
    expect(finishCalls()[0][0]).toEqual({ where: { id: "run1", status: "running" }, data: expect.objectContaining({ status: "done", response: "결과" }) });
  });

  it("work 실패 → failed + 메시지", async () => {
    await startRun({ kind: "trial", versionId: "v1", targetKind: "report", targetRef: "morning_report" }, async () => {
      throw new Error("Claude CLI 실패");
    });
    await settled();
    expect(finishCalls()[0][0]).toEqual({ where: { id: "run1", status: "running" }, data: expect.objectContaining({ status: "failed", errorMessage: "Claude CLI 실패" }) });
  });

  it("실패 기록 저장까지 실패해도 throw 하지 않는다 (unhandled rejection 없음)", async () => {
    db.promptRun.updateMany.mockImplementation(async (arg: { where: { id?: string } }) => {
      if (arg.where.id) throw new Error("db down");
      return { count: 0 };
    });
    await startRun({ kind: "suggest", versionId: "v1" }, async () => "ok");
    await vi.waitFor(() => expect(finishCalls()).toHaveLength(2));
  });
});

// 회귀: PR #560 Codex P2 — 부팅 정리는 이 프로세스 시작 전 실행만 (새 워커가 정리 전에 받은 실행을 끊지 않게)
describe("sweepRunsOnBoot", () => {
  it("bootedAt 이전에 시작된 running 만 failed", async () => {
    const bootedAt = new Date("2026-10-19T06:00:00Z");
    await sweepRunsOnBoot(bootedAt);
    expect(db.promptRun.updateMany).toHaveBeenCalledWith({ where: { status: "running", startedAt: { lt: bootedAt } }, data: expect.objectContaining({ status: "failed" }) });
  });

  it("새 실행은 앱 시계로 startedAt 을 넣는다 (부팅 시각과 같은 시계로 비교)", async () => {
    await startRun({ kind: "suggest", versionId: "v1" }, async () => "ok");
    expect(db.promptRun.create.mock.calls[0][0].data.startedAt).toBeInstanceOf(Date);
  });
});
