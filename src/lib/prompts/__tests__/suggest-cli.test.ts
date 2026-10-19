// #552 M19-3 G1: 개선안 1회성 CLI — 성공 · 시간 초과 · CLI 오류 · 출력 깨짐
import { EventEmitter } from "node:events";
import type { spawn } from "child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { runSuggestCli } from "../suggest";

function fakeSpawn(stdout: string, code: number | null, signal: NodeJS.Signals | null = null) {
  const calls: string[][] = [];
  const impl = ((_bin: string, args: string[]) => {
    calls.push(args);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stdin: { end: () => {} } });
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(stdout));
      child.emit("close", code, signal);
    });
    return child;
  }) as unknown as typeof spawn;
  return { impl, calls };
}

describe("runSuggestCli", () => {
  it("성공 — result 본문 · 도구 없음 1턴", async () => {
    const { impl, calls } = fakeSpawn(JSON.stringify({ result: '{"body":"x"}' }), 0);
    await expect(runSuggestCli("p", { spawnImpl: impl })).resolves.toBe('{"body":"x"}');
    expect(calls[0]).toEqual(expect.arrayContaining(["--max-turns", "1", "--tools", ""]));
    expect(calls[0]).not.toContain("--mcp-config");
  });

  it("시간 초과 (SIGTERM)", async () => {
    const { impl } = fakeSpawn("", null, "SIGTERM");
    await expect(runSuggestCli("p", { spawnImpl: impl })).rejects.toThrow(/시간 초과/);
  });

  it("CLI 종료 코드 · is_error · JSON 아님", async () => {
    await expect(runSuggestCli("p", { spawnImpl: fakeSpawn("", 1).impl })).rejects.toThrow(/code 1/);
    await expect(runSuggestCli("p", { spawnImpl: fakeSpawn(JSON.stringify({ is_error: true, subtype: "error_max_turns" }), 0).impl })).rejects.toThrow(/error_max_turns/);
    await expect(runSuggestCli("p", { spawnImpl: fakeSpawn("not json", 0).impl })).rejects.toThrow(/읽지 못했습니다/);
  });
});
