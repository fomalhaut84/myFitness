import { spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { SYSTEM_PROMPT } from "./system-prompt";

const MCP_SERVER_PATH = path.resolve(process.cwd(), "dist/mcp/server.mjs");
const RUNTIME_CONFIG_DIR = path.resolve(process.cwd(), ".runtime");
const RUNTIME_MCP_CONFIG = path.resolve(RUNTIME_CONFIG_DIR, "mcp-config.json");

const TIMEOUT_MS = 180_000;

interface ClaudeResponse {
  result: string;
  duration_ms?: number;
}

function ensureMcpConfig(): string {
  // 런타임에 실제 DATABASE_URL로 MCP config 생성
  mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });

  const config = {
    mcpServers: {
      myfitness: {
        command: "node",
        args: [MCP_SERVER_PATH],
        env: {
          DATABASE_URL: process.env.DATABASE_URL ?? "",
        },
      },
    },
  };

  writeFileSync(RUNTIME_MCP_CONFIG, JSON.stringify(config, null, 2));
  return RUNTIME_MCP_CONFIG;
}

export async function askAdvisor(prompt: string): Promise<ClaudeResponse> {
  if (!existsSync(MCP_SERVER_PATH)) {
    throw new Error(
      "MCP 서버 빌드가 필요합니다. `npm run build:mcp`를 먼저 실행하세요."
    );
  }

  const mcpConfigPath = ensureMcpConfig();
  const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n사용자 질문: ${prompt}`;

  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      fullPrompt,
      "--output-format",
      "json",
      "--mcp-config",
      mcpConfigPath,
      "--model",
      "haiku",
      "--max-turns",
      "10",
    ];

    const startTime = Date.now();
    const child = spawn("claude", args, {
      timeout: TIMEOUT_MS,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    // stdin을 즉시 닫아 대기 방지
    child.stdin.end();

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
