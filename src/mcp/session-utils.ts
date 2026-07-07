/**
 * MCP HTTP transport 세션 관리용 순수 헬퍼.
 *
 * server.ts 는 module-load 시점에 main() 을 실행하므로 서버 로직에서 pure 헬퍼를
 * 뽑아 별도 파일로 관리 → 테스트 시 서버 부팅 없이 유닛 테스트 가능.
 */

/**
 * idle TTL 초과 세션 sid 만 골라 반환. sweeper 가 이 결과로 close/delete 수행.
 * `entries` 는 Map#entries() 또는 임의의 [sid, entry] 이터러블.
 */
export function pickStaleSessions<T extends { lastActivityAt: number }>(
  entries: Iterable<[string, T]>,
  now: number,
  ttlMs: number,
): string[] {
  const stale: string[] = [];
  for (const [sid, entry] of entries) {
    if (now - entry.lastActivityAt > ttlMs) stale.push(sid);
  }
  return stale;
}

/**
 * MCP HTTP transport 요청의 세션 처리 방식을 결정.
 *
 * - `reuse`: sessionIdHeader 가 존재하고 서버에 등록된 세션 → 기존 transport 사용
 * - `create`: sessionIdHeader 없이 initialize 요청 → 새 세션 생성
 * - `expired`: sessionIdHeader 는 있지만 서버에 없음 (sweeper 가 정리했거나 프로세스
 *   재시작) → 클라이언트에게 404 로 알려 stale 세션 폐기 + 재초기화 유도
 * - `invalid`: sessionIdHeader 없고 initialize 도 아님 → 400
 */
export type SessionResolution = "reuse" | "create" | "expired" | "invalid";

export function resolveSessionRequest(args: {
  sessionIdHeader: string | null;
  hasSession: boolean;
  isInitialize: boolean;
}): SessionResolution {
  if (args.sessionIdHeader && args.hasSession) return "reuse";
  if (!args.sessionIdHeader && args.isInitialize) return "create";
  if (args.sessionIdHeader) return "expired";
  return "invalid";
}
