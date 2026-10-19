// #552 M19-3 G1: 개선안 1회성 CLI — 성공 · 시간 초과 · CLI 오류 · 출력 깨짐
import { EventEmitter } from "node:events";
import type { spawn } from "child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { cliFailureMessage, runSuggestCli } from "../suggest";

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
    // 회귀: #563 — claude.ai 커넥터가 로드되지 않게
    expect(calls[0]).toContain("--strict-mcp-config");
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

// 회귀: #563 — 서버에서 "code 1" 만 보여 원인을 몰랐다 (error_max_turns · claude.ai 커넥터 호출 거부)
describe("cliFailureMessage", () => {
  it("subtype · 거부된 도구 · errors 를 담고 응답 본문은 넣지 않는다", () => {
    const stdout = JSON.stringify({
      subtype: "error_max_turns",
      is_error: true,
      result: "건강 데이터가 담긴 본문",
      errors: ["Reached maximum number of turns (1)"],
      permission_denials: [{ tool_name: "mcp__claude_ai_Claude_Docs__guide" }],
      api_error_status: null,
    });
    const msg = cliFailureMessage(stdout, 1);
    expect(msg).toContain("subtype=error_max_turns");
    expect(msg).toContain("거부된 도구=mcp__claude_ai_Claude_Docs__guide");
    expect(msg).toContain("Reached maximum number of turns (1)");
    expect(msg).not.toContain("건강 데이터");
  });

  it("JSON 이 아니면 종료 코드만 · api 상태가 있으면 포함", () => {
    expect(cliFailureMessage("boom", 1)).toBe("Claude CLI 가 실패했습니다 (code 1)");
    expect(cliFailureMessage(JSON.stringify({ subtype: "error", api_error_status: 529 }), 1)).toContain("api_status=529");
  });
});
