// #552 M19-3 T2: 실행 중 1건 (partial unique 위반 → 409) · 실패 시 failed + 메시지 · 성공 시 done
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  promptRun: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));

import { startRun } from "../runs";
import { PromptActionError } from "../versions";

/** 백그라운드 완료 (finishRun) 가 update 를 부를 때까지 */
async function settled(): Promise<void> {
  await vi.waitFor(() => expect(db.promptRun.update).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.promptRun.updateMany.mockResolvedValue({ count: 0 });
  db.promptRun.update.mockResolvedValue({});
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

  it("시작 전에 끊긴 running 을 failed 로 정리", async () => {
    await startRun({ kind: "suggest", versionId: "v1" }, async () => "ok");
    expect(db.promptRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "running" }) }));
  });

  it("work 성공 → done + 응답", async () => {
    const run = await startRun({ kind: "trial", versionId: "v1", targetKind: "report", targetRef: "morning_report" }, async () => "결과");
    expect(run).toEqual({ id: "run1" });
    await settled();
    expect(db.promptRun.update).toHaveBeenCalledWith({ where: { id: "run1" }, data: expect.objectContaining({ status: "done", response: "결과" }) });
  });

  it("work 실패 → failed + 메시지", async () => {
    await startRun({ kind: "trial", versionId: "v1", targetKind: "report", targetRef: "morning_report" }, async () => {
      throw new Error("Claude CLI 실패");
    });
    await settled();
    expect(db.promptRun.update).toHaveBeenCalledWith({ where: { id: "run1" }, data: expect.objectContaining({ status: "failed", errorMessage: "Claude CLI 실패" }) });
  });

  it("실패 기록 저장까지 실패해도 throw 하지 않는다 (unhandled rejection 없음)", async () => {
    db.promptRun.update.mockRejectedValue(new Error("db down"));
    await startRun({ kind: "suggest", versionId: "v1" }, async () => "ok");
    await vi.waitFor(() => expect(db.promptRun.update).toHaveBeenCalledTimes(2));
  });
});
