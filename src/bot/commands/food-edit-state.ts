// #292 (M14 Phase 2 #1): 봇 [수정] 버튼 클릭 → 편집 입력 대기 상태.
//
// #350: force_reply 폐기 → chat 단위 pending 으로 전환.
//   기존에는 key 가 (chatId, promptMessageId) 였고 라우팅을 reply_to_message.message_id 로
//   했다. force_reply 는 Telegram **클라이언트** 상태라 해당 메시지에 실제 답장하거나 그
//   메시지가 사라질 때까지 해제되지 않고, Bot API 에 회수 수단이 없다. 답장 안 된 프롬프트가
//   채팅방에 남으면 채팅방을 열 때마다 답장 입력폼이 영구 재무장된다.
//   → 프롬프트를 일반 메시지로 보내고, 해당 chat 의 다음 텍스트를 편집 입력으로 라우팅한다.
//
// chat 당 pending 은 1건. 버튼을 다시 눌러도 덮어쓰기라 스태킹이 발생하지 않는다.
//
// TTL: active 5분 단일 단계.
//   #350: 기존 grace tombstone (25분) 제거. reply-to 라우팅에서는 사용자가 프롬프트에
//   *명시적으로 답장*했을 때만 tombstone 이 히트해 안전했지만, chat 단위 라우팅에서 유지하면
//   만료 후 30분간 그 채팅의 모든 텍스트가 '만료되었습니다' 안내로 먹힌다. 만료 시 즉시
//   삭제하고 일반 라우팅 (식단 입력 / AI 질문) 으로 통과시킨다.
//
// 검증 실패 후 재시도: peek 는 소비하지 않는다. 오타 답장으로 entry 가 사라지면 정정 입력이
// AI 로 흘러가기 때문 (Codex P2 #293). 재프롬프트 시 markPendingEdit 으로 TTL 을 갱신한다.
//
// 단일 사용자 · 단일 프로세스 시나리오라 in-memory Map 으로 충분. Bot 재시작 시 pending
// 소실은 TTL 5분 이내에 입력하지 않으면 어차피 무효이므로 실질 영향 없음.

const ACTIVE_TTL_MS = 5 * 60 * 1000;

// #309: action — kcal (기본 · 숫자 입력) 또는 desc (텍스트 입력).
export type PendingEditAction = "kcal" | "desc";

interface PendingEdit {
  logId: string;
  action: PendingEditAction;
  activeUntil: number;
}

const pending = new Map<number, PendingEdit>();

/** 만료된 entry 를 제거하고 유효한 것만 반환 (lazy delete). */
function getActive(chatId: number): PendingEdit | null {
  const entry = pending.get(chatId);
  if (!entry) return null;
  if (Date.now() > entry.activeUntil) {
    pending.delete(chatId);
    return null;
  }
  return entry;
}

/**
 * chat 의 편집 대기 상태를 기록. 기존 pending 이 있으면 덮어쓴다 (버튼 재탭 · 재프롬프트).
 * action 미지정 시 kcal (기존 호환).
 */
export function markPendingEdit(
  chatId: number,
  logId: string,
  action: PendingEditAction = "kcal",
): void {
  pending.set(chatId, {
    logId,
    action,
    activeUntil: Date.now() + ACTIVE_TTL_MS,
  });
}

/** 유효한 pending 존재 여부. 만료된 entry 는 여기서 정리된다. */
export function isPendingEdit(chatId: number): boolean {
  return getActive(chatId) !== null;
}

/**
 * pending 정보 반환. **소비하지 않는다** — 입력이 malformed 여도 entry 가 유지되어
 * 재시도 가능해야 하기 때문 (Codex P2 #293). 만료 시 null.
 */
export function peekPendingEdit(
  chatId: number,
): { logId: string; action: PendingEditAction } | null {
  const entry = getActive(chatId);
  if (!entry) return null;
  return { logId: entry.logId, action: entry.action };
}

/** 성공 처리 · 취소 후 entry 명시 삭제. */
export function deletePendingEdit(chatId: number): void {
  pending.delete(chatId);
}

/**
 * #350: [✕ 취소] 버튼 전용. logId 가 일치할 때만 삭제한다.
 * 오래된 프롬프트의 취소 버튼을 뒤늦게 눌렀을 때 그 사이 시작된 **다른** 편집을 취소하지
 * 않기 위함. 반환값: 실제로 취소했으면 true.
 */
export function clearPendingEditFor(chatId: number, logId: string): boolean {
  const entry = getActive(chatId);
  if (!entry || entry.logId !== logId) return false;
  pending.delete(chatId);
  return true;
}

// 주기적 청소 — 만료된 entry 제거. lazy delete 로 대부분 정리되지만, 프롬프트만 띄우고
// 아무 메시지도 안 보내는 chat 의 entry 가 남지 않도록 보강.
setInterval(() => {
  const now = Date.now();
  for (const [chatId, entry] of pending.entries()) {
    if (now > entry.activeUntil) pending.delete(chatId);
  }
}, 60 * 1000).unref?.();
