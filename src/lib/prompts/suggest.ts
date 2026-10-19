// #552 M19-3 G1: AI 개선안 — 사용 중 버전 + 최근 결과를 1회성 Claude 호출 (도구 없음 · MCP 없음 — 음식 추정과 같은 방식) 에 넘긴다.
// job (PromptRun) 으로 돌린다: 본문 · 결과가 길어 60초 (Nginx 기본) 를 넘길 수 있다. 버전 저장은 사용자가 "초안으로 저장" 할 때만 (G2).
import { spawn } from "child_process";
import prisma from "@/lib/prisma";
import type { PromptKey } from "./definitions";
import { listPromptResults } from "./results";
import { categoryLabel, resultDate } from "@/components/prompts/result-labels";
import { startRun } from "./runs";
import { SUGGEST_RESULT_LIMIT, SUGGEST_TIMEOUT_MS, buildSuggestPrompt, parseSuggestion, type SuggestSample } from "./suggest-prompt";
import { PromptActionError } from "./versions";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

interface CliResult {
  result?: string;
  is_error?: boolean;
  subtype?: string;
}

export interface SuggestCliOptions {
  timeoutMs?: number;
  /** for testing — mock spawn */
  spawnImpl?: typeof spawn;
}

/** 1회성 호출 → 응답 본문. 실패는 사용자에게 보여 줄 문구로 throw (응답 원문은 로그에 남기지 않는다) */
export function runSuggestCli(prompt: string, opts: SuggestCliOptions = {}): Promise<string> {
  const spawnFn = opts.spawnImpl ?? spawn;
  const args = ["-p", prompt, "--output-format", "json", "--model", "sonnet", "--max-turns", "1", "--tools", ""];
  return new Promise<string>((resolve, reject) => {
    const child = spawnFn(CLAUDE_BIN, args, { timeout: opts.timeoutMs ?? SUGGEST_TIMEOUT_MS, cwd: process.cwd(), stdio: ["pipe", "pipe", "ignore"] });
    child.stdin?.end();
    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.on("error", (err: Error) => reject(new Error(`Claude CLI 를 실행하지 못했습니다: ${err.message}`)));
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal === "SIGTERM") return reject(new Error("시간 초과 — 3분 안에 개선안을 받지 못했습니다"));
      if (code !== 0) return reject(new Error(`Claude CLI 가 실패했습니다 (code ${code})`));
      let outer: CliResult;
      try {
        outer = JSON.parse(stdout) as CliResult;
      } catch {
        return reject(new Error("Claude CLI 출력을 읽지 못했습니다"));
      }
      if (outer.is_error) return reject(new Error(`Claude CLI 오류 (${outer.subtype ?? "unknown"})`));
      resolve(outer.result ?? "");
    });
  });
}

async function samplesFor(key: PromptKey, activeId: string): Promise<SuggestSample[]> {
  // 사용 중 버전의 결과를 먼저 — 없으면 (막 바꾼 직후) 버전 무관 최근 결과
  const own = await listPromptResults(key, [activeId], SUGGEST_RESULT_LIMIT);
  const rows = own.length > 0 ? own : await listPromptResults(key, [], SUGGEST_RESULT_LIMIT);
  return rows.map((r) => ({ label: `${resultDate(r.reportDate, r.createdAt)} ${categoryLabel(r.category)}`, response: r.response }));
}

/** 개선안 job 시작 — 출발점은 사용 중 버전. 결과 JSON 은 PromptRun.response 에 (형식이 틀리면 실패로 기록) */
export async function startSuggestion(key: PromptKey): Promise<{ id: string }> {
  const active = await prisma.promptVersion.findFirst({ where: { key, status: "active" }, select: { id: true, body: true } });
  if (!active) throw new PromptActionError(409, "사용 중 버전이 없습니다. 목록 화면을 다시 연 뒤 시도하세요");
  return startRun({ kind: "suggest", versionId: active.id }, async () => {
    const prompt = buildSuggestPrompt(key, active.body, await samplesFor(key, active.id));
    const raw = await runSuggestCli(prompt);
    const suggestion = parseSuggestion(raw);
    if (!suggestion) throw new Error(`개선안 형식이 올바르지 않습니다 (응답 ${raw.length}자)`);
    return JSON.stringify(suggestion);
  });
}
