// M#180: standalone PM2 프로세스로 승격 후에는 .env 를 스스로 로드해야 함
// (기존 stdio 모드는 부모 프로세스인 bot/next 가 로드해서 상속받았음).
// import 순서상 다른 import 보다 먼저 — Prisma / prisma client 가 DATABASE_URL 을
// module load 시점에 검사.
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

import { pickStaleSessions, resolveSessionRequest } from "./session-utils";
import {
  logger,
  newTraceId,
  summarizeArgs,
  installCrashHandlers,
  isStdioMode,
} from "./logger";

import {
  getActivities,
  getSleep,
  getHeartRate,
  getDailyStats,
  getBodyComposition,
  getTrends,
} from "./tools/fitness";
import { getActivitySplits } from "./tools/splits";
import { getWeightLossStatus } from "./tools/weight-loss";
import { getBloodPressure } from "./tools/blood-pressure";
import { getUserProfile, getMetricHistory } from "./tools/user-profile";
import { getReadinessScore } from "./tools/readiness";
import { getTrainingLoadTrend } from "./tools/training-load";
import { getPaceProgression } from "./tools/pace-progression";
import { getCalendarSummary } from "./tools/calendar";
import { getInjuryRiskScore } from "./tools/injury-risk";
import { getRacePrediction } from "./tools/race-prediction";
import {
  generateTrainingPlan,
  getActiveTrainingPlan,
} from "./tools/training-plan";
import { recommendTodayWorkout } from "./tools/recommend-today-workout";

/**
 * tools/call 요청 처리 스코프. Handler wrapper 가 실행됐는지 tracking 해
 * SDK 우회 (Zod 검증 실패, 미등록 tool 등) 를 확실히 감지. prefix 매칭 heuristic
 * 대신 AsyncLocalStorage 로 정확한 실행 여부 확인.
 */
interface ToolCallContext {
  handlerInvoked: boolean;
  toolName?: string;
  args?: unknown;
  /** SDK 가 handler 우회로 전송하는 response 를 캡처하여 후처리 시 파싱 */
  capturedResponse?: unknown;
}
const toolCallStorage = new AsyncLocalStorage<ToolCallContext>();

/**
 * MCP tool result 에서 에러 메시지 추출. tools 가 반환하는
 * { isError: true, content: [{ type:'text', text:'...' }] } 형태 대상.
 */
function extractErrorMessage(result: unknown): string {
  if (!result || typeof result !== "object") return "unknown tool error";
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (
      typeof first === "object" &&
      first !== null &&
      typeof (first as { text?: unknown }).text === "string"
    ) {
      return (first as { text: string }).text;
    }
  }
  return "unknown tool error";
}

/**
 * Handler 우회로 SDK 가 전송한 response 에서 에러 정보 추출 → tool_call_sdk_error 로 로깅.
 * Transport 계층 (JSON message) 대상이라 HTTP SSE 파싱 불필요.
 */
function logSdkBypass(ctx: ToolCallContext): void {
  const response = ctx.capturedResponse as
    | {
        result?: { isError?: unknown; content?: unknown };
        error?: { code?: number; message?: string };
      }
    | undefined;
  const base = {
    tool: ctx.toolName ?? "unknown",
    args: summarizeArgs(ctx.args),
    status: "error",
  };
  if (!response) {
    logger.warn(
      {
        ...base,
        err: {
          message: "handler not invoked (no response captured)",
          kind: "sdk_error",
        },
      },
      "tool_call_sdk_error",
    );
    return;
  }
  if (response.error) {
    logger.warn(
      {
        ...base,
        err: {
          code: response.error.code,
          message: response.error.message,
          kind: "sdk_error",
        },
      },
      "tool_call_sdk_error",
    );
    return;
  }
  if (response.result) {
    logger.warn(
      {
        ...base,
        err: { message: extractErrorMessage(response.result), kind: "sdk_error" },
      },
      "tool_call_sdk_error",
    );
    return;
  }
  logger.warn(
    {
      ...base,
      err: {
        message: "handler not invoked (empty response)",
        kind: "sdk_error",
      },
    },
    "tool_call_sdk_error",
  );
}

/**
 * Transport 를 instrument — tools/call 요청마다 AsyncLocalStorage context 를 열고
 * transport.send 를 tap 해 SDK 응답 캡처. Stdio/HTTP transport 모두 공통.
 * server.connect(transport) 이후 호출해야 SDK 가 등록한 onmessage 를 감쌈.
 */
function attachToolCallInstrumentation(transport: unknown): void {
  const t = transport as {
    onmessage?: (msg: unknown, extra?: unknown) => void | Promise<void>;
    send: (msg: unknown, ...rest: unknown[]) => Promise<void>;
  };
  const originalOnMessage = t.onmessage;
  const originalSend = t.send.bind(t);

  t.send = async (msg: unknown, ...rest: unknown[]) => {
    // Send 는 onmessage 반환 이후 별도 tick 에서 호출될 수 있어, onmessage 완료 시점에
    // 응답 존재 여부를 판단하기 어려움. 그래서 send 시점에 직접 검사:
    // ctx 존재 + handler 미실행 + error/isError 응답 → SDK 우회. 여기서 로그.
    const ctx = toolCallStorage.getStore();
    if (ctx && !ctx.handlerInvoked && msg && typeof msg === "object") {
      const asObj = msg as { result?: { isError?: unknown }; error?: unknown };
      if (
        asObj.error ||
        (asObj.result &&
          (asObj.result as { isError?: unknown }).isError === true)
      ) {
        ctx.capturedResponse = msg;
        logSdkBypass(ctx);
      }
    }
    return originalSend(msg, ...rest);
  };

  if (originalOnMessage) {
    t.onmessage = async (msg: unknown, extra?: unknown) => {
      const req = msg as
        | { method?: string; params?: { name?: string; arguments?: unknown } }
        | undefined;
      if (req?.method === "tools/call") {
        const ctx: ToolCallContext = {
          handlerInvoked: false,
          toolName: req.params?.name,
          args: req.params?.arguments,
        };
        await toolCallStorage.run(ctx, async () => {
          await originalOnMessage(msg, extra);
        });
      } else {
        await originalOnMessage(msg, extra);
      }
    };
  }
}

/**
 * MCP server factory — 세션마다 fresh 인스턴스 필요 (multi-session HTTP 대응).
 * stdio 모드에서는 단일 호출로 충분, HTTP 모드에서는 initialize 마다 호출.
 *
 * server.tool 을 wrapping 하여 모든 tool 호출을 구조화 로그로 기록 (#194).
 */
export function createMyFitnessMcpServer(): McpServer {
  const server = new McpServer({
    name: "myfitness",
    version: "1.0.0",
  });

  // Monkey-patch server.tool → 각 handler 를 latency/status/traceId 로 계측.
  // 원래 signature 다양 (arg count 4~5) 지만 handler 는 항상 마지막 인자.
  const originalTool = server.tool.bind(server) as (
    ...args: unknown[]
  ) => unknown;
  (server as unknown as { tool: unknown }).tool = (...args: unknown[]) => {
    if (args.length === 0) return originalTool(...args);
    const toolName = typeof args[0] === "string" ? args[0] : "unknown";
    const lastIdx = args.length - 1;
    const originalHandler = args[lastIdx];
    if (typeof originalHandler !== "function") return originalTool(...args);

    const instrumentedHandler = async (...handlerArgs: unknown[]) => {
      // AsyncLocalStorage 로 handler 실행 여부 시그널링 (SDK 우회 감지용).
      const ctx = toolCallStorage.getStore();
      if (ctx) ctx.handlerInvoked = true;

      const traceId = newTraceId();
      const start = Date.now();
      try {
        const result = await (
          originalHandler as (...a: unknown[]) => Promise<unknown>
        )(...handlerArgs);
        // MCP tool 은 실패를 두 방식으로 시그널: (1) throw, (2) { isError: true, content }
        // (resolved result). status 를 result.isError 로 판단하지 않으면 실패가
        // 로그에서 성공으로 오분류 → 에러율 모니터링 사각지대.
        const isError =
          typeof result === "object" &&
          result !== null &&
          (result as { isError?: unknown }).isError === true;
        if (isError) {
          logger.warn(
            {
              tool: toolName,
              traceId,
              latency_ms: Date.now() - start,
              status: "error",
              args: summarizeArgs(handlerArgs[0]),
              err: {
                message: extractErrorMessage(result),
                kind: "tool_reported_error",
              },
            },
            "tool_call_reported_error",
          );
        } else {
          logger.info(
            {
              tool: toolName,
              traceId,
              latency_ms: Date.now() - start,
              status: "ok",
              args: summarizeArgs(handlerArgs[0]),
            },
            "tool_call",
          );
        }
        return result;
      } catch (error) {
        logger.error(
          {
            tool: toolName,
            traceId,
            latency_ms: Date.now() - start,
            status: "error",
            args: summarizeArgs(handlerArgs[0]),
            err:
              error instanceof Error
                ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                  }
                : { message: String(error) },
          },
          "tool_call_failed",
        );
        throw error;
      }
    };

    const patchedArgs = [...args.slice(0, lastIdx), instrumentedHandler];
    return originalTool(...patchedArgs);
  };

server.tool(
  "get_activities",
  "최근 운동 활동 목록 조회 (거리, 페이스, 심박, 칼로리 등)",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 14)"),
    type: z.string().optional().describe("활동 타입 필터 (running, strength 등)"),
  },
  async (args) => getActivities(args)
);

server.tool(
  "get_sleep",
  "수면 기록 조회 (수면 단계, 점수, 시작/종료 시간)",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 14)"),
  },
  async (args) => getSleep(args)
);

server.tool(
  "get_heart_rate",
  "안정시 심박수 + HRV 추세 조회",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 30)"),
  },
  async (args) => getHeartRate(args)
);

server.tool(
  "get_daily_stats",
  "일일 통계 조회 (걸음, 칼로리, 스트레스, 바디배터리)",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 14)"),
  },
  async (args) => getDailyStats(args)
);

server.tool(
  "get_body_composition",
  "체중/체지방 추세 조회",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 90)"),
  },
  async (args) => getBodyComposition(args)
);

server.tool(
  "get_trends",
  "주간 또는 월간 집계 통계 (활동, 일일, 수면 종합)",
  {
    period: z.enum(["week", "month"]).describe("집계 기간 (week 또는 month)"),
  },
  async (args) => getTrends(args)
);

server.tool(
  "get_activity_splits",
  "특정 활동의 km별(lap별) 구간 데이터 조회 (페이스/심박/케이던스/고도/강도 타입). 한계치 런·인터벌 분석에 사용.",
  {
    activityId: z
      .string()
      .trim()
      .min(1)
      .describe("활동의 DB id(cuid) 또는 Garmin garminId 문자열"),
  },
  async (args) => getActivitySplits(args)
);

server.tool(
  "get_weight_loss_status",
  "최근 7일 체중·칼로리·운동 통합 요약. 감량 진행도, 근손실 위험 평가, 리포트 작성에 사용.",
  {},
  async () => getWeightLossStatus()
);

server.tool(
  "get_blood_pressure",
  "혈압 추세 조회 (수축기/이완기/맥박, 카테고리 분류, 경고). 건강 지표 연계 분석에 사용.",
  {
    days: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .describe("조회 일수 (기본 30)"),
  },
  async (args) => getBloodPressure(args)
);

server.tool(
  "get_user_profile",
  "사용자 프로필 + Garmin 자동 동기화된 maxHR/LTHR/Zone/VO2max 통합 조회. 각 값에 source 표시.",
  {},
  async () => getUserProfile()
);

server.tool(
  "get_metric_history",
  "프로필 메트릭(maxHR/lthr/lthrPace/vo2maxRunning/restingHRBase) 변경 이력 조회. 시간 경과에 따른 피트니스 변화 추적.",
  {
    field: z
      .enum(["maxHR", "lthr", "lthrPace", "vo2maxRunning", "restingHRBase"])
      .optional()
      .describe("필드 필터. 생략하면 모든 필드"),
    days: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .describe("조회 일수 (기본 90)"),
  },
  async (args) => getMetricHistory(args)
);

server.tool(
  "get_readiness_score",
  "오늘 회복 점수 (Garmin bodyBatteryHigh 기반, 0-100) + 5단계 강도 추천 + HRV/restingHR 7일 평균 대비 deviation + 어제 트레이닝 로드. 모닝 리포트의 오늘 강도 결정에 사용.",
  {},
  async () => getReadinessScore()
);

server.tool(
  "get_training_load_trend",
  "트레이닝 로드 추세 (ACWR 기반). Acute 7d / Chronic 28d / 보조 14d 일평균 부하 + ACWR + 4단계 위험 구간 (detraining / sweet_spot / high / very_high). 주간 리포트의 오버/언더트레이닝 평가에 사용.",
  {},
  async () => getTrainingLoadTrend()
);

server.tool(
  "get_pace_progression",
  "거리 bucket(5k/10k/HM/FM)별 러닝 페이스 추세. baseline/latest/best + improvementPct(%) + 최근 5건. 주간/장기 리포트의 진척도 평가에 사용.",
  {
    windowDays: z
      .number()
      .int()
      .min(30)
      .max(365)
      .optional()
      .describe("조회 일수 (기본 90, 30~365)"),
  },
  async (args) => getPaceProgression(args)
);

server.tool(
  "get_calendar_summary",
  "N일 일자별 핵심 지표 한 줄씩 (최신순) — 러닝 km/횟수, 안정시HR, 수면 점수/시간, bodyBattery, 칼로리 밸런스, 걸음수. summary에 기간 총합. 주간/월간 리포트에서 일자별 상황 훑기에 사용.",
  {
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("조회 일수 (기본 14, 1~90)"),
  },
  async (args) => getCalendarSummary(args)
);

server.tool(
  "get_injury_risk_score",
  "부상/오버트레이닝 위험 점수 (0-100) + 4단계 라벨 (safe/caution/elevated/high) + 기여 요인 top 3 + 권장 조치. 4개 요인 각 25% 가중치: HRV 하락(7일 vs 이전 7일), ACWR(M5-2-2 동일), 수면 점수 불안정(14일 CV), RHR 상승(7일 vs 28일 baseline). 모닝 리포트의 회복일/강도 결정에 사용.",
  {},
  async () => getInjuryRiskScore()
);

server.tool(
  "generate_training_plan",
  "4주 트레이닝 플랜을 결정적으로 생성 + DB 저장. 입력: weeklyFrequency(3~5, 기본 4), targetDistance(5K/10K/HM/FM, optional), targetDate(YYYY-MM-DD, targetDistance 필수). 기존 active plan 은 archived 처리. Wk1 baseline / Wk2 +10% / Wk3 +10% / Wk4 taper. LTHR pace 기반 zone/pace 배분. race 목표 있고 targetDate 가 plan 창 내면 Wk4 는 targetDate 까지 선형 감소 + race 당일 rest.",
  {
    weeklyFrequency: z
      .number()
      .int()
      .min(3)
      .max(5)
      .optional()
      .describe("주간 러닝 횟수 (3~5, 기본 4)"),
    targetDistance: z
      .enum(["5K", "10K", "HM", "FM"])
      .optional()
      .describe("목표 race 거리"),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("race 예정일 YYYY-MM-DD (targetDistance 와 함께만)"),
  },
  async (args) => generateTrainingPlan(args)
);

server.tool(
  "get_active_training_plan",
  "현재 active 트레이닝 플랜 조회 + 진행 파생. 각 workout 은 completed/missed/pending 상태 (workout date 의 KST 일자 러닝 activity 매칭, 계획 대비 90% 이상 거리면 completed). 오늘 workout + 전체 진행률 요약 포함.",
  {},
  async () => getActiveTrainingPlan()
);

server.tool(
  "recommend_today_workout",
  "오늘 실제로 뛸 workout 을 결정적으로 추천 (read-only). active plan 의 오늘 workout 을 base 로, plan 이 없으면 baseline 기반 easy 로 fallback. readiness (M5-2-1) + injury risk (M6-2) 라벨을 매트릭스로 조합해 downgrade 단계 (0/1/2/rest) 결정 후, downgrade ladder (interval→tempo→easy→recovery→rest, long→easy 는 거리 60%) 적용. target pace 는 ±5% 범위. rationale (한국어) 포함.",
  {},
  async () => recommendTodayWorkout()
);

server.tool(
  "get_race_prediction",
  "5K/10K/HM/FM race 예상 기록 (Riegel 공식). 각 target 3 시나리오: best/realistic/conservative (source bucket의 best/latest/baseline pace). 자체 bucket 우선, 없으면 다른 bucket에서 Riegel 환산. confidence는 count 기반. '10K 페이스로 풀마라톤 도전 가능?' 같은 질문에 사용.",
  {
    windowDays: z
      .number()
      .int()
      .min(30)
      .max(365)
      .optional()
      .describe("조회 일수 (기본 90, 30~365)"),
  },
  async (args) => getRacePrediction(args)
);

  return server;
}

// --- 서버 시작 ---

// #180 / #194: 빈 문자열 ('') 도 default 로 취급. logger.ts 와 shared source of truth
// (isStdioMode). server 는 stdio 로 진입했는데 logger 만 http 로 오판하면 stdout
// (JSON-RPC 채널) 이 오염됨.
const TRANSPORT_MODE = isStdioMode() ? "stdio" : "http";
const rawPort = process.env.MCP_PORT;
const HTTP_PORT = rawPort && !Number.isNaN(parseInt(rawPort, 10))
  ? parseInt(rawPort, 10)
  : 4301;
const HTTP_HOST = "127.0.0.1";

async function startStdio(): Promise<void> {
  const server = createMyFitnessMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  attachToolCallInstrumentation(transport);
  logger.info({ transport: "stdio" }, "transport_ready");
}

/**
 * 세션 idle 상한. 이 시간 동안 요청이 없으면 sweeper 가 정리.
 * Claude CLI 가 timeout/SIGKILL 로 죽으면 DELETE 도 onclose 도 트리거되지 않아
 * transports Map 이 무한 누적 → 방어책.
 */
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000; // 30분
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5분

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastActivityAt: number;
}

/**
 * Multi-session HTTP mode — myFinance Phase 32-A PoC 결과 (PR #406/407) 반영.
 * 세션마다 별도 `StreamableHTTPServerTransport` + `McpServer` 페어를 생성해
 * `mcp-session-id` 헤더로 라우팅. 단일 transport 재사용은 재초기화 reject 됨.
 */
async function startHttp(): Promise<void> {
  const transports = new Map<string, SessionEntry>();

  const httpServer = createHttpServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";

      if (url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            uptime: process.uptime(),
            sessions: transports.size,
            version: "1.0.0",
          })
        );
        return;
      }

      if (url === "/mcp" || url.startsWith("/mcp?")) {
        const t0 = Date.now();
        const sessionIdHeader =
          (req.headers["mcp-session-id"] as string | undefined) ?? null;
        try {
          let body: unknown;
          if (req.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const bodyText = Buffer.concat(chunks).toString("utf-8");
            body = bodyText ? JSON.parse(bodyText) : undefined;
          }

          const method =
            (body as { method?: string } | undefined)?.method ?? "(no-body)";
          const isInit = method === "initialize";

          let transport: StreamableHTTPServerTransport | undefined;
          const resolution = resolveSessionRequest({
            sessionIdHeader,
            hasSession: sessionIdHeader
              ? transports.has(sessionIdHeader)
              : false,
            isInitialize: isInit,
          });

          if (resolution === "reuse") {
            const entry = transports.get(sessionIdHeader!)!;
            entry.lastActivityAt = Date.now(); // TTL 갱신
            transport = entry.transport;
          } else if (resolution === "create") {
            // sid 를 outer 로 캡처 → SDK 가 sessionId 를 언제 clear 하든 onclose 에서 안정적 삭제.
            let assignedSid: string | undefined;
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid: string) => {
                assignedSid = sid;
                transports.set(sid, {
                  transport: transport!,
                  lastActivityAt: Date.now(),
                });
                logger.info(
                  { sid, total: transports.size },
                  "session_initialized",
                );
              },
            });
            transport.onclose = () => {
              if (assignedSid) {
                transports.delete(assignedSid);
                logger.info(
                  { sid: assignedSid, total: transports.size },
                  "session_closed",
                );
              }
            };
            const s = createMyFitnessMcpServer();
            await s.connect(transport);
            attachToolCallInstrumentation(transport);
          } else if (resolution === "expired") {
            // Session id 는 있지만 서버에 없음 (sweeper 정리 or 프로세스 재시작).
            // MCP 표준: 404 로 클라이언트가 stale 세션 폐기 후 재초기화하도록 시그널.
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32001,
                  message: `Session not found: ${sessionIdHeader}`,
                },
                id: null,
              })
            );
            return;
          } else {
            // resolution === "invalid" — session id 없고 initialize 도 아님.
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32600,
                  message: "Bad Request: no session id and not initialize",
                },
                id: null,
              })
            );
            return;
          }

          await transport!.handleRequest(req, res, body);
          logger.info(
            {
              httpMethod: req.method,
              rpcMethod: method,
              sid: sessionIdHeader ?? "(new)",
              latency_ms: Date.now() - t0,
            },
            "http_request",
          );
          return;
        } catch (error) {
          logger.error(
            {
              err:
                error instanceof Error
                  ? { message: error.message, stack: error.stack }
                  : String(error),
            },
            "http_request_error",
          );
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "internal_error" }));
          }
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found", url }));
    }
  );

  httpServer.on("error", (err) => {
    // EADDRINUSE 등 listen 실패 시 즉시 종료 → PM2 backoff 로 재시도 (이전 프로세스 정리 대기).
    logger.fatal(
      { err: { message: err.message, stack: err.stack } },
      "http_server_error",
    );
    process.exit(1);
  });

  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    logger.info(
      { transport: "http", host: HTTP_HOST, port: HTTP_PORT },
      "transport_ready",
    );
  });

  // Idle session sweeper — Claude CLI 가 timeout/SIGKILL 로 죽으면 DELETE 도
  // onclose 도 트리거되지 않아 transports 가 누적. 주기적으로 idle 세션 close.
  const sweeper = setInterval(() => {
    const stale = pickStaleSessions(
      transports.entries(),
      Date.now(),
      SESSION_IDLE_TTL_MS
    );
    if (stale.length === 0) return;
    logger.info(
      { count: stale.length, ttl_min: SESSION_IDLE_TTL_MS / 60_000 },
      "session_sweep",
    );
    for (const sid of stale) {
      const entry = transports.get(sid);
      if (!entry) continue;
      Promise.resolve(entry.transport.close?.()).catch(() => {
        /* ignore */
      });
      // onclose 콜백이 실행되어야 Map 이 정리되지만, 안전망으로 직접 삭제.
      transports.delete(sid);
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  sweeper.unref?.(); // 이벤트 루프 blocker 방지 (shutdown 시 정상 종료 허용)

  // Graceful shutdown — PM2 SIGTERM 대응.
  // httpServer.close() 는 새 연결만 거부하고 SSE 스트림은 유지되므로,
  // 활성 transport 를 명시적으로 close → transports Map 정리 → httpServer close 순서.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(sweeper);
    logger.info(
      { signal, activeSessions: transports.size },
      "shutdown_started",
    );
    const closeTasks = Array.from(transports.values()).map((entry) =>
      Promise.resolve(entry.transport.close?.()).catch((err) => {
        logger.error(
          {
            err:
              err instanceof Error
                ? { message: err.message, stack: err.stack }
                : String(err),
          },
          "transport_close_error",
        );
      }),
    );
    await Promise.allSettled(closeTasks);
    transports.clear();
    httpServer.close(() => {
      logger.info({}, "http_server_closed");
      process.exit(0);
    });
    // Node 18.2+: 활성 소켓도 강제 종료 → SSE 스트림 lingering 방지
    if (
      typeof (httpServer as unknown as { closeAllConnections?: () => void })
        .closeAllConnections === "function"
    ) {
      (
        httpServer as unknown as { closeAllConnections: () => void }
      ).closeAllConnections();
    }
    // 15s 이내 강제 종료 (safety net) — unref 하지 않아 이벤트 루프 blocker 로 유지.
    setTimeout(() => {
      logger.warn({}, "force_exit_after_15s");
      process.exit(1);
    }, 15000);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function main() {
  // Crash handlers 는 main 진입 즉시 설치 → 로거 초기화 실패 등 초기 오류도 캡처.
  installCrashHandlers();
  if (TRANSPORT_MODE === "http") {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((error) => {
  logger.fatal(
    {
      err:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : String(error),
    },
    "startup_error",
  );
  process.exit(1);
});
