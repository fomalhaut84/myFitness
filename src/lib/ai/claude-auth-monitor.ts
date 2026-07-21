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

  try {
    // Rate-limit 체크 (DB persistent, pm2 restart 생존).
    const existing = await prisma.systemAlertState.findUnique({
      where: { alertType: AUTH_ALERT_TYPE },
      select: { lastAlertAt: true },
    });
    if (
      existing &&
      now.getTime() - existing.lastAlertAt.getTime() < RATE_LIMIT_MS
    ) {
      // 이미 최근 1시간 내 알림 발송됨 → 서버 로그만.
      console.warn(
        `[claude-auth] EXPIRED (rate-limited, last=${existing.lastAlertAt.toISOString()}): ${errMsg.slice(0, 200)}`,
      );
      return;
    }

    // 알림 push (bot 없으면 skip). 실제 발송 성공 여부를 별도 tracking — 사전 리뷰 P1:
    // bot=undefined 또는 sendToAll 이 sent=0 반환 (chat 별 실패는 내부 catch) 인 경우
    // rate-limit 을 소진하면 실제로 admin 이 알림을 못 받은 채 최대 1시간 lockout.
    const errSnippet = errMsg.slice(0, 200);
    let actuallyDelivered = false;
    if (bot) {
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
        actuallyDelivered = r.sent > 0;
        if (!actuallyDelivered) {
          console.warn(
            `[claude-auth] admin alert 전송 대상 없음/전부 실패 (sent=${r.sent}/total=${r.total}) — rate-limit 유예`,
          );
        }
      } catch (sendErr) {
        console.error(
          `[claude-auth] admin alert 전송 실패: ${sanitizeError(sendErr)}`,
        );
      }
    } else {
      console.warn(
        "[claude-auth] bot 참조 없음 (webapp 경로) — alert skip, rate-limit 유예",
      );
    }

    if (!actuallyDelivered) {
      // 실 발송이 없으면 rate-limit 소진하지 않음 → 다음 실패 시 즉시 재시도.
      return;
    }

    console.warn(
      `[claude-auth] EXPIRED — admin alert 발송 (${errSnippet})`,
    );

    // DB upsert — 실 발송 성공 시에만 rate-limit 시작.
    await prisma.systemAlertState.upsert({
      where: { alertType: AUTH_ALERT_TYPE },
      update: { lastAlertAt: now, lastErrorMsg: errSnippet },
      create: {
        alertType: AUTH_ALERT_TYPE,
        lastAlertAt: now,
        lastErrorMsg: errSnippet,
      },
    });
  } catch (dbErr) {
    console.error(
      `[claude-auth] rate-limit 상태 조회/저장 실패: ${sanitizeError(dbErr)}`,
    );
  }
}
