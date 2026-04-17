import { spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { buildSystemPrompt } from "./system-prompt";

const MCP_SERVER_PATH = path.resolve(process.cwd(), "dist/mcp/server.mjs");
const RUNTIME_CONFIG_DIR = path.resolve(process.cwd(), ".runtime");
const RUNTIME_MCP_CONFIG = path.resolve(RUNTIME_CONFIG_DIR, "mcp-config.json");

const TIMEOUT_MS = 180_000;

// 세션 ID 관리 (프로세스 메모리에 유지)
let currentSessionId: string | null = null;

interface ClaudeResponse {
  result: string;
  sessionId: string | null;
  duration_ms?: number;
}

function ensureMcpConfig(): string {
  mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });

  const config = {
    mcpServers: {
      myfitness: {
        command: "node",
        args: [MCP_SERVER_PATH],
        env: {
          DATABASE_URL: process.env.DATABASE_URL ?? "",
          APP_BASE_URL: `http://localhost:${process.env.PORT ?? "4200"}`,
        },
      },
    },
  };

  writeFileSync(RUNTIME_MCP_CONFIG, JSON.stringify(config, null, 2));
  return RUNTIME_MCP_CONFIG;
}

export function resetSession(): void {
  currentSessionId = null;
}

export function getSessionId(): string | null {
  return currentSessionId;
}

export async function askAdvisor(prompt: string): Promise<ClaudeResponse> {
  if (!existsSync(MCP_SERVER_PATH)) {
    throw new Error(
      "MCP 서버 빌드가 필요합니다. `npm run build:mcp`를 먼저 실행하세요."
    );
  }

  const mcpConfigPath = ensureMcpConfig();

  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--mcp-config",
    mcpConfigPath,
    "--model",
    "haiku",
    "--max-turns",
    "10",
    "--allowedTools",
    "mcp__myfitness__get_activities,mcp__myfitness__get_sleep,mcp__myfitness__get_heart_rate,mcp__myfitness__get_daily_stats,mcp__myfitness__get_body_composition,mcp__myfitness__get_trends,mcp__myfitness__get_activity_splits",
  ];

  // 기존 세션이 있으면 --resume, 없으면 시스템 프롬프트와 함께 새 세션
  if (currentSessionId) {
    args.push("--resume", currentSessionId);
  } else {
    const systemPrompt = await buildSystemPrompt();
    // 첫 메시지에 시스템 프롬프트 포함
    args[1] = `${systemPrompt}\n\n---\n\n사용자 질문: ${prompt}`;
  }

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const child = spawn("claude", args, {
      timeout: TIMEOUT_MS,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

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

        // 세션 ID 저장
        if (parsed.session_id) {
          currentSessionId = parsed.session_id;
        }

        resolve({
          result: parsed.result ?? parsed.text ?? stdout,
          sessionId: currentSessionId,
          duration_ms: durationMs,
        });
      } catch {
        resolve({
          result: stdout.trim(),
          sessionId: currentSessionId,
          duration_ms: durationMs,
        });
      }
    });

    child.on("error", (error) => {
      reject(new Error(`Claude CLI 실행 실패: ${error.message}`));
    });
  });
}
