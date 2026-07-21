// #253: Claude CLI 실패를 카테고리로 분류하고, 인증 만료 시 관리자에게 rate-limited
// Telegram alert 발송. 봇/cron/UI 응답을 사용자-actionable 문구로 정규화하는 helper 도 제공.
//
// 2026-07-21 사고: Claude 인증 만료됐지만 자동 감지 없이 사용자 UX 저하로만 확인. 재발 방지.

import type { Bot } from "grammy";
import prisma from "@/lib/prisma";
import { sanitizeError } from "@/bot/utils/error";
import { sendToAll } from "@/bot/notifications/send";

/**
 * Claude CLI 실패 카테고리. claude-advisor 가 던지는 Error message 문자열 + 원 stderr /
 * api_error_status 흔적 을 기반으로 매핑.
 */
export type ClaudeErrorCategory =
  | "auth_expired"
  | "rate_limit"
  | "tool_missing"
  | "network"
  | "unknown";

const AUTH_PATTERNS = [
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
const RATE_LIMIT_PATTERNS = [
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
const NETWORK_PATTERNS = [
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /getaddrinfo/i,
  /network/i,
];

function anyMatch(msg: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(msg));
}

/** Claude 관련 실패 문자열을 카테고리로 분류. 매칭 안 되면 "unknown". */
export function classifyClaudeError(err: unknown): ClaudeErrorCategory {
  const msg = err instanceof Error ? err.message : String(err);
  if (anyMatch(msg, AUTH_PATTERNS)) return "auth_expired";
  if (anyMatch(msg, RATE_LIMIT_PATTERNS)) return "rate_limit";
  if (anyMatch(msg, TOOL_MISSING_PATTERNS)) return "tool_missing";
  if (anyMatch(msg, NETWORK_PATTERNS)) return "network";
  return "unknown";
}

/** 카테고리 → 사용자 노출 문구. 원본 error message 는 서버 로그로만. */
export function formatUserFriendlyError(err: unknown): string {
  const category = classifyClaudeError(err);
  switch (category) {
    case "auth_expired":
      return "⚠️ AI 서비스 인증이 만료됐습니다. 관리자에게 알림 전송됨. 잠시 후 재시도해 주세요.";
    case "rate_limit":
      return "⏰ AI 요청량이 한도에 도달했습니다. 잠시 후 재시도해 주세요.";
    case "tool_missing":
      return "🔧 AI 가 데이터를 못 불러왔어요. 잠시 후 재시도해 주세요.";
    case "network":
      return "🌐 네트워크 문제로 AI 응답이 실패했습니다. 잠시 후 재시도해 주세요.";
    default:
      return "❌ AI 요청 처리 중 오류가 발생했습니다. 서버 로그 확인 필요.";
  }
}

const AUTH_ALERT_TYPE = "claude_auth_expired";
const RATE_LIMIT_MS = 60 * 60 * 1000; // 1시간

/** KST 로컬 시각 짧은 표기 (알림 본문용). */
function nowKstDisplay(): string {
  const now = new Date();
  return now.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 감지된 error 가 auth_expired 이면 관리자 Telegram alert 발송 (1시간 rate-limit, DB persistent).
 * best-effort: 알림/DB 실패해도 caller flow 는 영향 안 받음.
 * bot 이 undefined 이면 로그만 남김 (webapp 경로 호환).
 */
export async function notifyAdminIfAuthExpired(
  bot: Bot | undefined,
  err: unknown,
): Promise<void> {
  if (classifyClaudeError(err) !== "auth_expired") return;
  const errMsg = err instanceof Error ? err.message : String(err);
  const now = new Date();

  const errSnippet = errMsg.slice(0, 200);

  // 사전 리뷰 P1 대응: bot 참조 없으면 (webapp 경로) rate-limit 예약하지 않음 →
  // admin 이 실제로 알림 못 받은 채 lockout 방지. 서버 로그만.
  if (!bot) {
    console.warn(
      `[claude-auth] EXPIRED (bot 없음, alert skip): ${errSnippet}`,
    );
    return;
  }

  try {
    // Codex P2 (PR #254) 대응: 두 concurrent 실패가 동일 stale row 를 읽고 둘 다 발송하면
    // 중복 알림 + rate-limit 우회. UPDATE ... WHERE lastAlertAt < cutoff 로 slot 을 원자적
    // 예약. 예약 실패 (다른 caller 가 방금 예약 or 아직 1시간 안 지남) → skip.
    // Row 자체가 없으면 INSERT — unique 제약이 concurrent 두 caller 중 하나만 성공 허용.
    const cutoff = new Date(now.getTime() - RATE_LIMIT_MS);
    const updated = await prisma.systemAlertState.updateMany({
      where: {
        alertType: AUTH_ALERT_TYPE,
        lastAlertAt: { lt: cutoff },
      },
      data: { lastAlertAt: now, lastErrorMsg: errSnippet },
    });
    let reserved = updated.count > 0;
    if (!reserved) {
      // updateMany count=0: row 없음 또는 아직 rate-limit 내. 첫 발생 케이스 대비 INSERT 시도.
      try {
        await prisma.systemAlertState.create({
          data: {
            alertType: AUTH_ALERT_TYPE,
            lastAlertAt: now,
            lastErrorMsg: errSnippet,
          },
        });
        reserved = true;
      } catch {
        // Unique 제약 위반 → row 존재 + 아직 rate-limit 내. 다른 caller 가 방금 예약.
        reserved = false;
      }
    }
    if (!reserved) {
      console.warn(
        `[claude-auth] EXPIRED (rate-limited): ${errSnippet}`,
      );
      return;
    }

    // 예약 성공 → 알림 발송. 전송 실패 시 rate-limit 유지 (다음 재시도는 1시간 후).
    // Telegram 자체 장애 시 반복 push 로 상황 악화 방지 + 서버 로그로 fallback.
    const message = [
      `⚠️ <b>Claude 인증 만료 감지</b>`,
      `시각: ${nowKstDisplay()} (KST)`,
      "",
      `서버에서 아래 명령 실행 필요:`,
      `<code>claude login</code>`,
      "",
      `<b>에러</b>: ${errSnippet}`,
    ].join("\n");
    try {
      const r = await sendToAll(bot, message);
      if (r.sent === 0) {
        console.warn(
          `[claude-auth] admin alert 전송 실패 (sent=0/total=${r.total}) — rate-limit 유지, 서버 로그 확인 필요`,
        );
      } else {
        console.warn(
          `[claude-auth] EXPIRED — admin alert 발송 (${errSnippet})`,
        );
      }
    } catch (sendErr) {
      console.error(
        `[claude-auth] admin alert 전송 예외: ${sanitizeError(sendErr)} — rate-limit 유지`,
      );
    }
  } catch (dbErr) {
    console.error(
      `[claude-auth] rate-limit 상태 조회/저장 실패: ${sanitizeError(dbErr)}`,
    );
  }
}
