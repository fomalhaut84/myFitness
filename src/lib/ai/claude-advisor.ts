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
  num_turns?: number;
}

export interface AskOptions {
  /** 세션 격리 채널. web/telegram/cron-morning/cron-evening/cron-weekly/default 등. */
  channel?: string;
  /**
   * #197: num_turns < minTurns 이면 tool 호출 없이 답변한 것으로 간주.
   *
   * `num_turns` 는 Claude Code SDK 에서 "agentic turn round trip" — 여러 MCP
   * 도구를 batched 로 병렬 호출하면 num_turns=2 로 정상 완료 가능. 즉 tool 호출
   * count 가 아님. minTurns=2 는 "최소 tool 호출 1회는 있어야 한다" 의 안전장치
   * (num_turns=1 은 tool 없이 답변 = hallucination 확정).
   * 미달 시 1회 자동 재시도 후에도 미달이면 throw (조용한 실패 방지).
   */
  minTurns?: number;
}

/**
 * #197: LLM 이 응답 본문에 흘려보낸 tool_use JSON 배열/객체 아티팩트 제거.
 * 실제 tool_use 이벤트가 아니라 텍스트로 그대로 stringify 된 케이스 방어.
 *
 * 정규식 lazy quantifier 는 nested `input:{...}` 의 inner `}` 에서 멈춰 outer `}`
 * 를 남기는 버그가 있어 balanced brace scanning 으로 처리.
 */
export function stripToolCallArtifacts(text: string): string {
  if (!text) return text;
  const marker = /"type"\s*:\s*"tool_use"/g;
  let result = text;
  let removed = false;
  // 최대 반복 (안전장치): 예상보다 많은 tool_use 가 있어도 무한 루프 방지.
  for (let i = 0; i < 100; i++) {
    marker.lastIndex = 0;
    const m = marker.exec(result);
    if (!m) break;
    // marker 앞쪽에서 가장 가까운 `{` 찾기 — 이게 outer tool_use 객체의 시작.
    const start = result.lastIndexOf("{", m.index);
    if (start < 0) break;
    // Balanced brace scanning — nested `input:{...}` 도 정확히 매칭.
    let depth = 0;
    let end = -1;
    for (let j = start; j < result.length; j++) {
      const c = result[j];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break;
    result = result.slice(0, start) + result.slice(end + 1);
    removed = true;
  }
  // Object 제거가 실제로 있었을 때만 배열/쉼표 후처리. 정상 응답에 포함된
  // JSON/JS 예제의 `[]` 를 실수로 파괴하지 않도록 (Codex bot P3).
  if (removed) {
    result = result.replace(/\[\s*(?:,\s*)*\]/g, "");
    result = result.replace(/,\s*,/g, ",");
    result = result.replace(/\[\s*,/g, "[");
    result = result.replace(/,\s*\]/g, "]");
    result = result.replace(/\n{3,}/g, "\n\n").trim();
  }
  return result;
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
            // splits tool (src/mcp/tools/splits.ts) 이 APP_BASE_URL 참조. Claude CLI 는
            // stdio MCP subprocess env 에 부모 env 를 자동 상속 안 하므로 명시 pass.
            APP_BASE_URL: `http://localhost:${process.env.PORT ?? "4200"}`,
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

/**
 * #200/#244: 재시도 시 프롬프트 앞에 삽입되는 강화 지시. 첫 시도가 tool 호출 없이 끝난
 * 원인 (LLM 이 최신 데이터 불필요하다고 판단) 을 직접 반박해 tool 호출 유도.
 * #244: Sonnet cron 컨텍스트 tool skip 확률 상승 → 명령적 톤 + 실패 조건 명시로 강화.
 */
const RETRY_BOOST_PREFIX = `[중요 지시 — 반드시 MCP 도구 호출로 데이터를 수집한 뒤 답하세요]

이전 응답이 도구 호출 없이 끝나 폐기됐습니다. 도구를 호출하지 않고 리포트를 작성하면
사실이 아닐 확률이 높아 사용자에게 전달할 수 없습니다. 반드시 다음 절차를 지키세요:

1. 먼저 필요한 mcp__myfitness__* 도구를 병렬로 호출해 최신 데이터를 수집합니다.
   최소 1개 이상 도구를 호출해야 하며, 도구 결과가 없으면 리포트 생성을 중단하세요.
2. 도구 결과의 실제 수치만 인용합니다. 추측/기억/일반론으로 답변하면 안 됩니다.
3. 데이터 수집이 끝난 후에만 최종 리포트를 작성합니다.

---

`;

/**
 * #244: env 로 tuning 가능. 기본 MAX_RETRIES=2 (총 3회) — Sonnet cron hallucination 완화.
 * 값 부적절 시 fallback 2. 상한 5 (무한 시도/비용 제한).
 */
function envInt(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

/** env ASK_ADVISOR_BOOST_FIRST=1|true → 첫 시도부터 boost prefix 적용 (#244 F3). */
function envBool(key: string): boolean {
  const raw = process.env[key];
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * #197/#200/#244: askAdvisor guard wrapper — minTurns 검증 + 재시도 (강화 프롬프트) + 응답 필터.
 * 실패 로그에 Claude CLI session_id 포함 (#244 F4).
 * MCP tool_call 로그의 `sid` (HTTP transport sid) 는 별개 UUID 라 문자열 매칭이 아닌
 * timestamp window (± 몇 초) 로 조인. 두 ID 를 함께 남겨 조사 시 grep 범위 좁히기 용이.
 */
export async function askAdvisor(
  prompt: string,
  options: AskOptions = {},
): Promise<ClaudeResponse> {
  const channel = options.channel ?? DEFAULT_CHANNEL;
  const minTurns = options.minTurns ?? 0;
  const maxRetries = envInt("ASK_ADVISOR_MAX_RETRIES", 2, 0, 5);
  const boostFirst = envBool("ASK_ADVISOR_BOOST_FIRST");

  let lastResponse: ClaudeResponse | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // #200/#244: boostFirst=true 이면 첫 시도부터 강화 prefix. 아니면 재시도만.
    const applyBoost = boostFirst || attempt > 0;
    const effectivePrompt = applyBoost ? `${RETRY_BOOST_PREFIX}${prompt}` : prompt;
    const response = await askAdvisorOnce(effectivePrompt, options);
    lastResponse = response;
    if ((response.num_turns ?? 0) >= minTurns) {
      return { ...response, result: stripToolCallArtifacts(response.result) };
    }
    const nextAttempt = attempt + 1;
    const sidPart = response.sessionId
      ? ` session=${response.sessionId.slice(0, 8)}`
      : "";
    console.warn(
      `[askAdvisor] channel=${channel}${sidPart} turns=${response.num_turns ?? 0} < minTurns=${minTurns} — attempt ${attempt + 1}/${maxRetries + 1}${nextAttempt <= maxRetries ? " retryWithBoost=true" : ""}`,
    );
    // 재시도 시 fresh session — 이전 대화가 짧게 끝난 원인 제거.
    SessionStore.resetSession(channel);
  }
  const failedSid = lastResponse?.sessionId
    ? ` last_session=${lastResponse.sessionId.slice(0, 8)}`
    : "";
  throw new Error(
    `askAdvisor: tool 호출 부족 (turns=${lastResponse?.num_turns ?? 0} < minTurns=${minTurns} after ${maxRetries + 1} attempts)${failedSid}`,
  );
}

async function askAdvisorOnce(
  prompt: string,
  options: AskOptions = {},
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
    // #197: Haiku 는 system prompt 를 무시하고 tool 호출 없이 답변하거나 (turns=1)
    // 응답 본문에 tool_use JSON 을 텍스트로 노출하는 사례 다수. Sonnet 으로 upgrade.
    "sonnet",
    "--max-turns",
    // 근본 fix (issue #179) 이후에도 여유 필요 시 재조정. 10 → 15 로 완화해
    // 정상 세션이 tool 호출 횟수 초과로 실패하는 경우를 방지.
    "15",
    "--allowedTools",
    // 주의: 여기 나열된 도구는 승인 프롬프트 없이 실행됨. mutating 도구(generate_training_plan
    // 등) 는 스케줄 리포트/일반 채팅에서 의도치 않게 상태를 바꿀 수 있으므로 여기에 포함하지 않음.
    // Plan 생성은 명시적 진입점 (POST /api/training-plan/generate) 에서 처리하고,
    // AI 는 read-only get_active_training_plan 만 사용.
    "mcp__myfitness__get_activities,mcp__myfitness__get_sleep,mcp__myfitness__get_heart_rate,mcp__myfitness__get_daily_stats,mcp__myfitness__get_body_composition,mcp__myfitness__get_trends,mcp__myfitness__get_activity_splits,mcp__myfitness__get_weight_loss_status,mcp__myfitness__get_blood_pressure,mcp__myfitness__get_user_profile,mcp__myfitness__get_metric_history,mcp__myfitness__get_readiness_score,mcp__myfitness__get_training_load_trend,mcp__myfitness__get_pace_progression,mcp__myfitness__get_calendar_summary,mcp__myfitness__get_injury_risk_score,mcp__myfitness__get_race_prediction,mcp__myfitness__get_active_training_plan,mcp__myfitness__recommend_today_workout,mcp__myfitness__get_personal_goals",
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
  // M12 (#223): dynamic context 는 세션 유무 무관하게 매 호출 prepend →
  // resume 시에도 최신 개인 목표/시간 반영. 이전엔 새 세션에만 붙었음.
  const dynamicContext = await buildDynamicContext();
  if (currentSessionId) {
    args.push("--resume", currentSessionId);
    args[1] = `${dynamicContext}\n\n---\n\n사용자 질문: ${prompt}`;
  } else {
    const staticPrompt = await buildStaticSystemPrompt();
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
          num_turns: parsed.num_turns,
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
