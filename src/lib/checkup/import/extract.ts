// #532: 결과지 이미지 1장 → Claude Vision → 검증된 쪽 결과.
// 도구 전부 차단 (`--tools ""`) — 업로드 이미지가 프롬프트 인젝션 경로다. Read 를 열면 경로를 제한해도 서버 파일을
// 읽을 수 있다 (2026-10-16 PoC · 음식 사진 #309 Codex P1 과 같은 위험). PDF 는 브라우저가 이미지로 바꿔 보낸다.
// 로그에는 실패 종류 · 길이만 — 응답 원문은 건강 데이터라 남기지 않는다.
import { spawn } from "child_process";
import { buildExtractPrompt } from "./extract-prompt";
import { parseExtractResponse, type ExtractedPage } from "./extract-schema";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
/** Nginx proxy_read_timeout 60초 안 — 장당 실측 9~11초 */
export const EXTRACT_TIMEOUT_MS = 50_000;

export type ExtractFailure = "spawn" | "timeout" | "cli" | "parse";

export type ExtractResult = { ok: true; page: ExtractedPage } | { ok: false; reason: ExtractFailure };

export interface ExtractOptions {
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

interface CliResult {
  result?: string;
  is_error?: boolean;
  subtype?: string;
}

export function extractCheckupPage(imagePath: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const spawnFn = opts.spawnImpl ?? spawn;
  const args = [
    "-p",
    buildExtractPrompt(imagePath),
    "--output-format",
    "json",
    "--model",
    "sonnet",
    "--max-turns",
    "1",
    "--tools",
    "",
  ];

  return new Promise<ExtractResult>((resolve) => {
    const child = spawnFn(CLAUDE_BIN, args, {
      timeout: opts.timeoutMs ?? EXTRACT_TIMEOUT_MS,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin?.end();
    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.on("error", (err: Error) => {
      console.warn(`[checkup-extract] spawn 실패: ${err.message}`);
      resolve({ ok: false, reason: "spawn" });
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal === "SIGTERM") {
        console.warn("[checkup-extract] 시간 초과");
        return resolve({ ok: false, reason: "timeout" });
      }
      if (code !== 0) {
        console.warn(`[checkup-extract] CLI exit code=${code}`);
        return resolve({ ok: false, reason: "cli" });
      }
      let outer: CliResult;
      try {
        outer = JSON.parse(stdout) as CliResult;
      } catch {
        console.warn(`[checkup-extract] CLI 출력 JSON 아님 (length=${stdout.length})`);
        return resolve({ ok: false, reason: "cli" });
      }
      if (outer.is_error) {
        console.warn(`[checkup-extract] CLI is_error subtype=${outer.subtype ?? "?"}`);
        return resolve({ ok: false, reason: "cli" });
      }
      const page = parseExtractResponse(outer.result ?? "");
      if (!page) {
        console.warn(`[checkup-extract] 응답 검증 실패 (length=${(outer.result ?? "").length})`);
        return resolve({ ok: false, reason: "parse" });
      }
      resolve({ ok: true, page });
    });
  });
}
