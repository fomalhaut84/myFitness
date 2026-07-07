import { spawn } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { buildStaticSystemPrompt, buildDynamicContext } from "./system-prompt";
import * as SessionStore from "./session-store";

const RUNTIME_CONFIG_DIR = path.resolve(process.cwd(), ".runtime");
const RUNTIME_MCP_CONFIG = path.resolve(RUNTIME_CONFIG_DIR, "mcp-config.json");

// M#180: MCP transport 는 서버와 client(여기) 가 동시에 같은 모드여야 함.
// 기본 http (pm2 앱 myfitness-mcp 상시 상주). MCP_TRANSPORT=stdio 로 회귀 스위치.
const MCP_TRANSPORT = process.env.MCP_TRANSPORT || "http";

// HTTP url 우선순위: MCP_HTTP_URL (완전 URL) → MCP_PORT (포트만) → 4301 fallback.
// ecosystem 의 mcp/bot 앱이 두 env 를 공유해 어긋남 방지.
const MCP_HTTP_URL =
  process.env.MCP_HTTP_URL ||
  `http://127.0.0.1:${process.env.MCP_PORT || "4301"}/mcp`;

// stdio 회귀 시 spawn 할 서버 실행 파일. server.cjs 는 MCP_TRANSPORT 미설정/stdio
// 이면 startStdio() 로 분기하므로 그대로 재사용.
const MCP_SERVER_PATH = path.resolve(process.cwd(), "dist/mcp/server.cjs");

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

  // M#180: 서버 mode (MCP_TRANSPORT) 에 맞춰 client config 도 스위치.
  // - http (기본): myfitness-mcp pm2 앱 상시 상주 → HTTP url 참조
  // - stdio: pm2 앱 없이 dist/mcp/server.cjs 를 매번 subprocess spawn (회귀)
  const serverConfig =
    MCP_TRANSPORT === "stdio"
      ? {
          command: "node",
          args: [MCP_SERVER_PATH],
          env: {
            DATABASE_URL: process.env.DATABASE_URL ?? "",
          },
        }
      : {
          type: "http",
          url: MCP_HTTP_URL,
        };

  const config = {
    mcpServers: {
      myfitness: serverConfig,
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
    // 근본 fix (issue #179) 이후에도 여유 필요 시 재조정. 10 → 15 로 완화해
    // 정상 세션이 tool 호출 횟수 초과로 실패하는 경우를 방지.
    "15",
    "--allowedTools",
    // 주의: 여기 나열된 도구는 승인 프롬프트 없이 실행됨. mutating 도구(generate_training_plan
    // 등) 는 스케줄 리포트/일반 채팅에서 의도치 않게 상태를 바꿀 수 있으므로 여기에 포함하지 않음.
    // Plan 생성은 명시적 진입점 (POST /api/training-plan/generate) 에서 처리하고,
    // AI 는 read-only get_active_training_plan 만 사용.
    "mcp__myfitness__get_activities,mcp__myfitness__get_sleep,mcp__myfitness__get_heart_rate,mcp__myfitness__get_daily_stats,mcp__myfitness__get_body_composition,mcp__myfitness__get_trends,mcp__myfitness__get_activity_splits,mcp__myfitness__get_weight_loss_status,mcp__myfitness__get_blood_pressure,mcp__myfitness__get_user_profile,mcp__myfitness__get_metric_history,mcp__myfitness__get_readiness_score,mcp__myfitness__get_training_load_trend,mcp__myfitness__get_pace_progression,mcp__myfitness__get_calendar_summary,mcp__myfitness__get_injury_risk_score,mcp__myfitness__get_race_prediction,mcp__myfitness__get_active_training_plan,mcp__myfitness__recommend_today_workout",
    // #179: --tools "" 로 built-in 도구를 모두 제거 (MCP 도구는 영향 없음).
    // --allowedTools/--disallowedTools 는 permission prompt 만 제어할 뿐 built-in 도구 목록 자체를
    // 제한하지 않아 Agent/AskUserQuestion/PowerShell/Task 등이 여전히 Claude 컨텍스트에 남는다.
    // --tools "" 로 근본 차단하고 mcp__myfitness__* 만 allowedTools 로 남겨 승인 없이 실행되게 함.
    "--tools",
    "",
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

      // stdout 이 JSON 이면 항상 파싱 시도. code !== 0 이라도 subtype/num_turns/permission_denials/
      // errors/api_error_status 정보를 추출해 진단 가능한 에러 메시지 생성.
      let parsed: {
        session_id?: string;
        result?: string;
        text?: string;
        is_error?: boolean;
        subtype?: string;
        num_turns?: number;
        permission_denials?: Array<{ tool_name?: string }>;
        errors?: string[];
        api_error_status?: number;
        total_cost_usd?: number;
        usage?: { input_tokens?: number };
      } | null = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // ignore
      }

      if (code !== 0) {
        // Claude CLI 실패 — stdout JSON 에서 진단 정보 추출.
        if (parsed) {
          const subtype = parsed.subtype ?? "unknown";
          const numTurns = parsed.num_turns ?? 0;
          const denials = parsed.permission_denials ?? [];
          const deniedTools = denials
            .map((d) => d.tool_name)
            .filter(Boolean)
            .join(",");
          const parts = [`Claude CLI 실패 (subtype=${subtype}, turns=${numTurns})`];
          if (deniedTools) {
            parts.push(`거부된 도구=${deniedTools}`);
          }
          // SDK 가 errors: string[] 또는 api_error_status 를 담아주는 경우 (auth/rate-limit/model)
          // 그 원인을 잃지 않도록 메시지에 포함.
          if (parsed.api_error_status !== undefined) {
            parts.push(`api_status=${parsed.api_error_status}`);
          }
          if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
            parts.push(`errors=${parsed.errors.join(" ; ")}`);
          }
          const stderrTrim = stderr.trim();
          if (stderrTrim) {
            parts.push(`stderr=${stderrTrim.slice(0, 500)}`);
          }
          reject(new Error(parts.join(" | ")));
          return;
        }
        reject(
          new Error(`Claude CLI 에러 (code ${code}): ${stderr || stdout}`)
        );
        return;
      }

      if (parsed) {
        // 세션 ID + 누적 입력 토큰 저장 (채널별)
        if (parsed.session_id) {
          const inputTokens =
            typeof parsed.usage?.input_tokens === "number"
              ? parsed.usage.input_tokens
              : 0;
          SessionStore.setSession(channel, parsed.session_id, inputTokens);
        }

        // 완료 요약 로그 (pm2 logs 에서 채널별 정상 완료 확인용).
        // 실패 케이스는 별도로 reject 시 에러 메시지에 진단 정보가 실려 있어 스킵.
        const sessionShort = parsed.session_id?.slice(0, 8) ?? "no-session";
        const cost = parsed.total_cost_usd?.toFixed(4) ?? "?";
        const turns = parsed.num_turns ?? "?";
        const isError = parsed.is_error === true;
        console.log(
          `[askAdvisor] channel=${channel} duration=${durationMs}ms turns=${turns} session=${sessionShort} cost=$${cost}${
            isError ? " is_error=true" : ""
          }`
        );

        resolve({
          result: parsed.result ?? parsed.text ?? stdout,
          sessionId: parsed.session_id ?? currentSessionId,
          duration_ms: durationMs,
        });
      } else {
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
