import { spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { buildStaticSystemPrompt, buildDynamicContext } from "./system-prompt";

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
    "mcp__myfitness__get_activities,mcp__myfitness__get_sleep,mcp__myfitness__get_heart_rate,mcp__myfitness__get_daily_stats,mcp__myfitness__get_body_composition,mcp__myfitness__get_trends,mcp__myfitness__get_activity_splits,mcp__myfitness__get_weight_loss_status,mcp__myfitness__get_blood_pressure,mcp__myfitness__get_user_profile,mcp__myfitness__get_metric_history,mcp__myfitness__get_readiness_score,mcp__myfitness__get_training_load_trend,mcp__myfitness__get_pace_progression,mcp__myfitness__get_calendar_summary",
  ];

  // 기존 세션이 있으면 --resume (CLI가 세션의 기존 system 유지).
  // 새 세션:
  // - --append-system-prompt: Claude Code default(tool guidance/safety) 유지 + 우리 정적 prompt 추가.
  //   (--system-prompt는 default를 완전 교체 → tool guidance 손실, 사용 금지)
  // - --exclude-dynamic-system-prompt-sections: default의 동적 sections(cwd/env/git/memory)를
  //   user msg로 옮겨 system param 정적성 향상 → cache 적중률 ↑.
  // - 동적 부분(현재 시간)은 user message 앞에 prepend.
  if (currentSessionId) {
    args.push("--resume", currentSessionId);
  } else {
    const staticPrompt = await buildStaticSystemPrompt();
    const dynamicContext = buildDynamicContext();
    args[1] = `${dynamicContext}\n\n---\n\n사용자 질문: ${prompt}`;
    args.push("--append-system-prompt", staticPrompt);
    args.push("--exclude-dynamic-system-prompt-sections");
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
