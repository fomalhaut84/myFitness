// 회귀: #563 — Claude CLI 를 부르는 모든 소스가 격리 인자 (--strict-mcp-config) 를 쓰는지. 새 호출 경로가 빠뜨리면 실패한다.
// 서버 CLI 는 계정의 claude.ai 커넥터를 MCP 로 자동 로드한다 → 1회성 호출이 error_max_turns 로 실패 (2026-10-19 개선안 장애)
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_CLI_ISOLATION_ARGS } from "../cli-isolation";

const SRC = path.resolve(__dirname, "../../..");
const SPAWN_CLAUDE = /spawn(?:Fn)?\(\s*CLAUDE_BIN\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("Claude CLI 격리 인자", () => {
  it("--strict-mcp-config 를 담는다", () => {
    expect(CLAUDE_CLI_ISOLATION_ARGS).toContain("--strict-mcp-config");
  });

  it("CLAUDE_BIN 을 spawn 하는 모든 파일이 CLAUDE_CLI_ISOLATION_ARGS 를 인자에 넣는다", () => {
    const callers = sourceFiles(SRC).filter((f) => SPAWN_CLAUDE.test(readFileSync(f, "utf8")));
    expect(callers.length).toBeGreaterThanOrEqual(7);
    const missing = callers.filter((f) => !readFileSync(f, "utf8").includes("...CLAUDE_CLI_ISOLATION_ARGS")).map((f) => path.relative(SRC, f));
    expect(missing).toEqual([]);
  });
});
