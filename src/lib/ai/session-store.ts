/**
 * 채널별 Claude CLI 세션 보관소.
 * - 봇 프로세스에서 사용자 채팅 / cron 리포트 등이 같은 sessionId 공유로 컨텍스트 오염되는 것을 방지.
 * - TTL (6h 무활동) 또는 누적 입력 토큰 한도 (100k) 초과 시 자동 reset.
 * - 메모리 상태 (재시작 시 초기화) — 영속 불필요.
 * - #552 R6: 세션을 만든 시스템 프롬프트 버전을 기록 — 웹에서 다른 버전을 활성화하면 다음 호출에서 새 세션.
 *   웹 · 봇이 별도 PM2 프로세스라 활성화 시점에 상대 프로세스 메모리를 비울 수 없어서 각자 호출 때 감지한다.
 */

const TTL_MS = 6 * 60 * 60 * 1000;
const TOKEN_LIMIT = 100_000;

interface SessionEntry {
  sessionId: string;
  lastActiveAt: number;
  cumulativeInputTokens: number;
  /** 세션 시작 때의 시스템 프롬프트 버전 (코드 기본값 폴백이면 null) */
  systemVersionId: string | null;
}

const store = new Map<string, SessionEntry>();

/**
 * 채널의 유효 sessionId 반환. TTL/토큰 한도 초과 시 자동 reset 후 null.
 * `systemVersionId` 를 주면 세션의 시스템 프롬프트 버전과 다를 때도 reset (#552 R6).
 */
export function getSession(channel: string, systemVersionId?: string | null): string | null {
  const entry = store.get(channel);
  if (!entry) return null;
  if (systemVersionId !== undefined && entry.systemVersionId !== systemVersionId) {
    store.delete(channel);
    return null;
  }
  const now = Date.now();
  if (now - entry.lastActiveAt > TTL_MS) {
    store.delete(channel);
    return null;
  }
  if (entry.cumulativeInputTokens > TOKEN_LIMIT) {
    store.delete(channel);
    return null;
  }
  return entry.sessionId;
}

/** 세션 갱신. 누적 토큰은 더해서 보관. addInputTokens는 음수면 0으로 보정. */
export function setSession(
  channel: string,
  sessionId: string,
  addInputTokens = 0,
  systemVersionId: string | null = null
): void {
  const existing = store.get(channel);
  store.set(channel, {
    sessionId,
    lastActiveAt: Date.now(),
    cumulativeInputTokens:
      (existing?.cumulativeInputTokens ?? 0) + Math.max(0, addInputTokens),
    systemVersionId,
  });
}

/** 특정 채널 reset. */
export function resetSession(channel: string): void {
  store.delete(channel);
}

/** 모든 채널 reset (디버깅/긴급용). */
export function resetAll(): void {
  store.clear();
}
