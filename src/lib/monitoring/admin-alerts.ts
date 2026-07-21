// #253/#256: 실패 카테고리 분류 + 관리자 rate-limited Telegram alert + 사용자용 short 문구.
//
// v2.16.1 (#253) 은 Claude 인증만 대상. #256 로 Garmin 재인증 실패 + MCP transport 다운 확장.
//
// 2026-07-21 사고 배경: Claude 인증 만료가 자동 감지 없이 사용자 UX 저하로만 확인. 재발 방지.

import type { Bot } from "grammy";
import prisma from "@/lib/prisma";
import { sanitizeError } from "@/bot/utils/error";
import { sendToAll } from "@/bot/notifications/send";

// ─── 카테고리 정의 ─────────────────────────────────────────────────────────

/** 실패 카테고리. classify* 함수들이 반환. */
export type FailureCategory =
  | "claude_auth_expired"
  | "claude_rate_limit"
  | "mcp_transport_down"
  | "garmin_auth_failed"
  | "tool_missing"
  | "network"
  | "unknown";

/** SystemAlertState.alertType 값 (rate-limit 독립 관리). */
const ALERT_TYPE: Partial<Record<FailureCategory, string>> = {
  claude_auth_expired: "claude_auth_expired",
  mcp_transport_down: "mcp_transport_down",
  garmin_auth_failed: "garmin_auth_failed",
};

const RATE_LIMIT_MS = 60 * 60 * 1000; // 1시간

// ─── 패턴 매칭 ──────────────────────────────────────────────────────────────

const CLAUDE_AUTH_PATTERNS = [
  /authentication/i,
  /authenticate/i,
  /not\s+logged\s+in/i,
  /please\s+log\s*in/i,
  /please\s+run.*login/i,
  /invalid\s+api\s+key/i,
  /unauthorized/i,
  /api_status=401/i,
  /api_error_status\s*[:=]\s*401/i,
];
const CLAUDE_RATE_LIMIT_PATTERNS = [
  /rate\s*limit/i,
  /too\s+many\s+requests/i,
  /api_status=429/i,
  /api_error_status\s*[:=]\s*429/i,
  /quota/i,
];
const TOOL_MISSING_PATTERNS = [
  /tool\s+호출\s+부족/, // askAdvisor turns=1 minTurns=2 실패 (#244)
  /minTurns/,
];
// MCP transport 다운: 클로드 CLI 가 로컬 127.0.0.1:4301 (또는 MCP_PORT) 에 접속 실패.
const MCP_TRANSPORT_PATTERNS = [
  /ECONNREFUSED.*(?:127\.0\.0\.1|localhost).*:\d{2,5}/i,
  /connect\s+ECONNREFUSED\s+127\.0\.0\.1/i,
  /MCP.*(?:transport|connection).*(?:refused|error|failed|not\s+ready)/i,
  /Cannot\s+connect\s+to\s+MCP/i,
  /mcp__myfitness__.*(?:refused|unreachable)/i,
];
const NETWORK_PATTERNS = [
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /getaddrinfo/i,
  /network/i,
];
// Garmin 재인증 실패: withReauth 이 재시도 후에도 401/403, 또는 login 자체 실패.
const GARMIN_AUTH_PATTERNS = [
  /Invalid\s+credentials/i,
  /Account\s+locked/i,
  /GARMIN_EMAIL\s+and\s+GARMIN_PASSWORD/i,
  /garmin.*login.*fail/i,
  /garmin.*(?:401|403|unauthorized)/i,
];

function anyMatch(msg: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(msg));
}

/**
 * Claude CLI + MCP transport 실패를 분류. dedicated (Garmin) 은 별도 helper 로.
 * 매칭 우선순위: MCP transport → Claude auth → Claude rate-limit → tool_missing → network.
 */
export function classifyClaudeError(err: unknown): FailureCategory {
  const msg = err instanceof Error ? err.message : String(err);
  // MCP 를 최우선 (auth 패턴이 ECONNREFUSED 아래 있어 오분류 방지).
  if (anyMatch(msg, MCP_TRANSPORT_PATTERNS)) return "mcp_transport_down";
  if (anyMatch(msg, CLAUDE_AUTH_PATTERNS)) return "claude_auth_expired";
  if (anyMatch(msg, CLAUDE_RATE_LIMIT_PATTERNS)) return "claude_rate_limit";
  if (anyMatch(msg, TOOL_MISSING_PATTERNS)) return "tool_missing";
  if (anyMatch(msg, NETWORK_PATTERNS)) return "network";
  return "unknown";
}

/** Garmin 관련 실패 문자열 여부. syncAll 상위 catch 에서 사용. */
export function isGarminAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return anyMatch(msg, GARMIN_AUTH_PATTERNS);
}

// ─── 사용자용 문구 ─────────────────────────────────────────────────────────

/** 카테고리 → 사용자 노출 문구. 원본 error message 는 서버 로그로만. */
export function formatUserFriendlyError(err: unknown): string {
  const category = classifyClaudeError(err);
  switch (category) {
    case "claude_auth_expired":
      return "⚠️ AI 서비스 인증이 만료됐습니다. 관리자에게 알림 전송됨. 잠시 후 재시도해 주세요.";
    case "claude_rate_limit":
      return "⏰ AI 요청량이 한도에 도달했습니다. 잠시 후 재시도해 주세요.";
    case "mcp_transport_down":
      return "🔧 데이터 도구 연결이 끊겼어요. 관리자에게 알림 전송됨. 잠시 후 재시도해 주세요.";
    case "tool_missing":
      return "🔧 AI 가 데이터를 못 불러왔어요. 잠시 후 재시도해 주세요.";
    case "network":
      return "🌐 네트워크 문제로 AI 응답이 실패했습니다. 잠시 후 재시도해 주세요.";
    default:
      return "❌ AI 요청 처리 중 오류가 발생했습니다. 서버 로그 확인 필요.";
  }
}

// ─── Rate-limited alert 코어 로직 ──────────────────────────────────────────

/** KST 로컬 시각 표기 (알림 본문). */
function nowKstDisplay(): string {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface AlertOptions {
  alertType: string;
  buildMessage: (errSnippet: string, kst: string) => string;
  logPrefix: string;
}

/**
 * 카테고리별 wrapper 가 공유하는 rate-limit + 예약 + 발송 + 실패 시 해제 코어.
 *
 * 규칙:
 *   1) bot 없음 (webapp) → alert skip, rate-limit 예약 안 함 (다음 발생 시 로그만)
 *   2) atomic reserve (updateMany WHERE lastAlertAt < now-1h + INSERT fallback)
 *   3) 예약 성공 → 알림 발송
 *   4) sent=0 or 예외 → conditional deleteMany 로 예약 해제 (next 실패 시 즉시 재시도)
 */
async function notifyRateLimitedAlert(
  bot: Bot | undefined,
  err: unknown,
  opts: AlertOptions,
): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  const errSnippet = errMsg.slice(0, 200);

  if (!bot) {
    console.warn(
      `${opts.logPrefix} 감지 (bot 없음, alert skip): ${errSnippet}`,
    );
    return;
  }

  const now = new Date();
  try {
    const cutoff = new Date(now.getTime() - RATE_LIMIT_MS);
    const updated = await prisma.systemAlertState.updateMany({
      where: {
        alertType: opts.alertType,
        lastAlertAt: { lt: cutoff },
      },
      data: { lastAlertAt: now, lastErrorMsg: errSnippet },
    });
    let reserved = updated.count > 0;
    if (!reserved) {
      try {
        await prisma.systemAlertState.create({
          data: {
            alertType: opts.alertType,
            lastAlertAt: now,
            lastErrorMsg: errSnippet,
          },
        });
        reserved = true;
      } catch {
        reserved = false;
      }
    }
    if (!reserved) {
      console.warn(`${opts.logPrefix} 감지 (rate-limited): ${errSnippet}`);
      return;
    }

    const message = opts.buildMessage(errSnippet, nowKstDisplay());
    let delivered = false;
    try {
      const r = await sendToAll(bot, message);
      delivered = r.sent > 0;
      if (delivered) {
        console.warn(`${opts.logPrefix} — admin alert 발송 (${errSnippet})`);
      } else {
        console.warn(
          `${opts.logPrefix} admin alert 전송 실패 (sent=0/total=${r.total}) — 예약 해제 후 재시도 유예`,
        );
      }
    } catch (sendErr) {
      console.error(
        `${opts.logPrefix} admin alert 전송 예외: ${sanitizeError(sendErr)} — 예약 해제`,
      );
    }
    if (!delivered) {
      try {
        await prisma.systemAlertState.deleteMany({
          where: { alertType: opts.alertType, lastAlertAt: now },
        });
      } catch (rollbackErr) {
        console.error(
          `${opts.logPrefix} 예약 해제 실패: ${sanitizeError(rollbackErr)}`,
        );
      }
    }
  } catch (dbErr) {
    console.error(
      `${opts.logPrefix} rate-limit 상태 조회/저장 실패: ${sanitizeError(dbErr)}`,
    );
  }
}

// ─── 카테고리별 wrapper ─────────────────────────────────────────────────────

export async function notifyClaudeAuthExpiredIfNeeded(
  bot: Bot | undefined,
  err: unknown,
): Promise<void> {
  if (classifyClaudeError(err) !== "claude_auth_expired") return;
  await notifyRateLimitedAlert(bot, err, {
    alertType: ALERT_TYPE.claude_auth_expired!,
    logPrefix: "[claude-auth] EXPIRED",
    buildMessage: (errSnippet, kst) =>
      [
        `⚠️ <b>Claude 인증 만료 감지</b>`,
        `시각: ${kst} (KST)`,
        "",
        `서버에서 아래 명령 실행 필요:`,
        `<code>claude login</code>`,
        "",
        `<b>에러</b>: ${errSnippet}`,
      ].join("\n"),
  });
}

export async function notifyMcpTransportDownIfNeeded(
  bot: Bot | undefined,
  err: unknown,
): Promise<void> {
  if (classifyClaudeError(err) !== "mcp_transport_down") return;
  await notifyRateLimitedAlert(bot, err, {
    alertType: ALERT_TYPE.mcp_transport_down!,
    logPrefix: "[mcp-transport] DOWN",
    buildMessage: (errSnippet, kst) =>
      [
        `🔧 <b>MCP transport 다운 감지</b>`,
        `시각: ${kst} (KST)`,
        "",
        `서버에서 상태 확인:`,
        `<code>pm2 status myfitness-mcp</code>`,
        `<code>curl -sf http://127.0.0.1:4301/health</code>`,
        "",
        `<b>에러</b>: ${errSnippet}`,
      ].join("\n"),
  });
}

export async function notifyGarminAuthFailedIfNeeded(
  bot: Bot | undefined,
  err: unknown,
): Promise<void> {
  if (!isGarminAuthError(err)) return;
  await notifyRateLimitedAlert(bot, err, {
    alertType: ALERT_TYPE.garmin_auth_failed!,
    logPrefix: "[garmin-auth] FAILED",
    buildMessage: (errSnippet, kst) =>
      [
        `⚠️ <b>Garmin 재인증 실패 감지</b>`,
        `시각: ${kst} (KST)`,
        "",
        `서버에서 확인:`,
        `<code>GARMIN_EMAIL / GARMIN_PASSWORD env 확인</code>`,
        `<code>Garmin 계정 상태 (locked / password 변경)</code>`,
        "",
        `<b>에러</b>: ${errSnippet}`,
      ].join("\n"),
  });
}

// ─── 통합 dispatcher ────────────────────────────────────────────────────────

/**
 * 알려진 카테고리 (Claude auth / MCP transport) 중 어느 것에라도 매칭되면 해당 wrapper
 * 호출. 매칭 안 되면 no-op. 3개 catch 지점 (ai / scheduler / auto-adjust) 에서 통합 호출.
 *
 * **주의**: Garmin 은 이 dispatcher 로 오지 않도록 (classifyClaudeError 의 unauthorized
 * /authentication 패턴이 Garmin `Unauthorized` 를 claude_auth_expired 로 오분류) —
 * 사전 리뷰 P1 반영. Garmin context 가 명확한 지점 (syncAll) 에서는
 * `notifyGarminAuthFailedIfNeeded` 를 직접 호출한다.
 */
export async function notifyAdminIfKnownFailure(
  bot: Bot | undefined,
  err: unknown,
): Promise<void> {
  const category = classifyClaudeError(err);
  if (category === "claude_auth_expired") {
    await notifyClaudeAuthExpiredIfNeeded(bot, err);
    return;
  }
  if (category === "mcp_transport_down") {
    await notifyMcpTransportDownIfNeeded(bot, err);
    return;
  }
  // Garmin 은 여기서 처리 안 함 — syncAll 등 context 명확한 지점에서 직접 호출.
  // 그 외 카테고리 (claude_rate_limit / tool_missing / network / unknown) 는 관리자 alert 아님.
}
