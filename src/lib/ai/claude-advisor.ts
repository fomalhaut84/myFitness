import { spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { buildStaticSystemPrompt, buildDynamicContext } from "./system-prompt";
import * as SessionStore from "./session-store";

const MCP_SERVER_PATH = path.resolve(process.cwd(), "dist/mcp/server.mjs");
const RUNTIME_CONFIG_DIR = path.resolve(process.cwd(), ".runtime");
const RUNTIME_MCP_CONFIG = path.resolve(RUNTIME_CONFIG_DIR, "mcp-config.json");

// Claude CLI 절대 경로 — 봇 프로세스가 pm2 delete + start 로 시작되면 login shell
// profile 이 로드되지 않아 ~/.local/bin 이 PATH에서 누락됨 → spawn ENOENT.
// .env 에 CLAUDE_BIN 명시로 회피. 미설정/빈문자열이면 PATH 조회 (개발 환경 편의).
// `||` 로 empty string도 fallback (nullish 는 empty string 통과시켜 spawn("") ERR_INVALID_ARG_VALUE 유발).
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

const TIMEOUT_MS = 180_000;
const DEFAULT_CHANNEL = "default";

interface ClaudeResponse {
  result: string;
  sessionId: string | null;
  duration_ms?: number;
}

export interface AskOptions {
  /** 세션 격리 채널. web/telegram/cron-morning/cron-evening/cron-weekly/default 등. */
  channel?: string;
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

/** 호환 wrapper: channel 미지정 시 모든 채널 reset, 지정 시 해당 채널만. */
export function resetSession(channel?: string): void {
  if (channel === undefined) SessionStore.resetAll();
  else SessionStore.resetSession(channel);
}

/** 호환 wrapper: channel 미지정 시 default 채널 sessionId. */
export function getSessionId(channel: string = DEFAULT_CHANNEL): string | null {
  return SessionStore.getSession(channel);
}

export async function askAdvisor(
  prompt: string,
  options: AskOptions = {}
): Promise<ClaudeResponse> {
  const channel = options.channel ?? DEFAULT_CHANNEL;
  const currentSessionId = SessionStore.getSession(channel);
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
    // 주의: 여기 나열된 도구는 승인 프롬프트 없이 실행됨. mutating 도구(generate_training_plan
    // 등) 는 스케줄 리포트/일반 채팅에서 의도치 않게 상태를 바꿀 수 있으므로 여기에 포함하지 않음.
    // Plan 생성은 별도 명시적 진입점에서 처리하고, AI 는 read-only get_active_training_plan 만 사용.
    "mcp__myfitness__get_activities,mcp__myfitness__get_sleep,mcp__myfitness__get_heart_rate,mcp__myfitness__get_daily_stats,mcp__myfitness__get_body_composition,mcp__myfitness__get_trends,mcp__myfitness__get_activity_splits,mcp__myfitness__get_weight_loss_status,mcp__myfitness__get_blood_pressure,mcp__myfitness__get_user_profile,mcp__myfitness__get_metric_history,mcp__myfitness__get_readiness_score,mcp__myfitness__get_training_load_trend,mcp__myfitness__get_pace_progression,mcp__myfitness__get_calendar_summary,mcp__myfitness__get_injury_risk_score,mcp__myfitness__get_race_prediction,mcp__myfitness__get_active_training_plan",
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
    const child = spawn(CLAUDE_BIN, args, {
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

        // 세션 ID + 누적 입력 토큰 저장 (채널별)
        if (parsed.session_id) {
          const inputTokens =
            typeof parsed.usage?.input_tokens === "number"
              ? parsed.usage.input_tokens
              : 0;
          SessionStore.setSession(channel, parsed.session_id, inputTokens);
        }

        resolve({
          result: parsed.result ?? parsed.text ?? stdout,
          sessionId: parsed.session_id ?? currentSessionId,
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
