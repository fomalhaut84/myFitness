import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { SYSTEM_PROMPT } from "./system-prompt";

const MCP_CONFIG_PATH = path.resolve(
  process.cwd(),
  "src/lib/ai/mcp-config.json"
);

const MCP_SERVER_PATH = path.resolve(process.cwd(), "dist/mcp/server.cjs");

const TIMEOUT_MS = 180_000;

interface ClaudeResponse {
  result: string;
  cost_usd?: number;
  duration_ms?: number;
}

export async function askAdvisor(prompt: string): Promise<ClaudeResponse> {
  if (!existsSync(MCP_SERVER_PATH)) {
    throw new Error(
      "MCP 서버 빌드가 필요합니다. `npm run build:mcp`를 먼저 실행하세요."
    );
  }

  const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n사용자 질문: ${prompt}`;

  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      fullPrompt,
      "--output-format",
      "json",
      "--mcp-config",
      MCP_CONFIG_PATH,
      "--model",
      "haiku",
      "--max-turns",
      "5",
    ];

    const startTime = Date.now();
    const child = spawn("claude", args, {
      timeout: TIMEOUT_MS,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "mcp" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;

      if (code !== 0) {
        reject(
          new Error(`Claude CLI 에러 (code ${code}): ${stderr || stdout}`)
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          result: parsed.result ?? parsed.text ?? stdout,
          duration_ms: durationMs,
        });
      } catch {
        // JSON 파싱 실패 시 raw text 반환
        resolve({
          result: stdout.trim(),
          duration_ms: durationMs,
        });
      }
    });

    child.on("error", (error) => {
      reject(new Error(`Claude CLI 실행 실패: ${error.message}`));
    });
  });
}
