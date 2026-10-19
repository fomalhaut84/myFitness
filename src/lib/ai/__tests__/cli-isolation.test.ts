// 회귀: #563 — Claude CLI 를 부르는 모든 소스가 격리 인자 (--strict-mcp-config) 를 쓰는지. 새 호출 경로가 빠뜨리면 실패한다.
// 서버 CLI 는 계정의 claude.ai 커넥터를 MCP 로 자동 로드한다 → 1회성 호출이 error_max_turns 로 실패 (2026-10-19 개선안 장애)
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_CLI_ISOLATION_ARGS } from "../cli-isolation";

const SRC = path.resolve(__dirname, "../../..");
/** Claude CLI 실행 — spawn · spawnFn · spawnSync · execFile 등, 실행 파일은 CLAUDE_BIN 또는 "claude" 리터럴 */
const RUN_CLAUDE = /\b(?:spawn|execFile)\w*\(\s*(?:CLAUDE_BIN\b|["']claude["'])/g;
const ISOLATION_SPREAD = /\.\.\.CLAUDE_CLI_ISOLATION_ARGS/g;
const count = (text: string, re: RegExp) => [...text.matchAll(re)].length;

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

  it("Claude CLI 를 실행하는 모든 파일이 실행 횟수 이상 CLAUDE_CLI_ISOLATION_ARGS 를 인자에 넣는다", () => {
    const callers = sourceFiles(SRC)
      .map((f) => ({ file: path.relative(SRC, f), text: readFileSync(f, "utf8") }))
      .filter(({ text }) => count(text, RUN_CLAUDE) > 0);
    // 정규식이 아무것도 못 찾아 조용히 통과하지 않게
    expect(callers.length).toBeGreaterThanOrEqual(7);
    // 한 파일에 실행이 둘인데 한 곳만 격리하면 걸리게 — 실행 수 ≤ 격리 인자 수
    const missing = callers.filter(({ text }) => count(text, ISOLATION_SPREAD) < count(text, RUN_CLAUDE)).map(({ file }) => file);
    expect(missing).toEqual([]);
  });
});
