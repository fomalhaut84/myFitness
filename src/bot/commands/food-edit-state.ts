// #292 (M14 Phase 2 #1): 봇 [수정] 버튼 클릭 → force_reply 프롬프트 대기 상태.
//
// 저장 key: (chatId, messageId) — Telegram message id 는 chat 안에서만 unique.
//   Codex P1 (#293): TELEGRAM_ALLOWED_CHAT_IDS 에 여러 chat 있으면 messageId 충돌 가능.
//
// TTL 두 단계:
//   - active (5분): 정상 응답 창
//   - grace (그 이후 25분, 총 30분): 만료 tombstone 유지 — 사용자에게 '만료' 안내 위해.
//   - grace 이후 (>30분): cleanup interval 이 hard-delete.
//   Codex P2 (#293): cleanup 이 grace 없이 즉시 삭제하면 사용자 답장이 AI fallback 으로 흘러가
//   만료 안내 대신 잘못된 응답을 받음.
//
// 검증 실패 후 재시도: consume 대신 peek/delete 분리 → validation 실패 시 delete 안 함.
//   Codex P2 (#293): 사용자가 오타로 '650a' 답장하면 entry 사라져 정정한 '650' 이 AI 로 흘러감.
//
// 단일 사용자 · 단일 프로세스 시나리오라 in-memory Map 충분. Bot 재시작 시 pending 소실은
// TTL 5분 이내에 답장 안 하면 어차피 무효 처리되므로 실질 영향 없음.

const ACTIVE_TTL_MS = 5 * 60 * 1000;
const GRACE_TTL_MS = 25 * 60 * 1000; // 만료 후 tombstone 유지 시간
const HARD_TTL_MS = ACTIVE_TTL_MS + GRACE_TTL_MS;

// #309: action 추가 — kcal (기본 · 숫자 답장) 또는 desc (텍스트 답장).
export type PendingEditAction = "kcal" | "desc";

interface PendingEdit {
  logId: string;
  action: PendingEditAction;
  activeUntil: number; // 이 시각까지는 정상 반영. 초과 시 만료 tombstone.
}

const pending = new Map<string, PendingEdit>();

function key(chatId: number, promptMessageId: number): string {
  return `${chatId}:${promptMessageId}`;
}

/** 프롬프트 messageId(+chatId) 를 key 로 log id 를 저장. action 미지정 시 kcal (기존 호환). */
export function markPendingEdit(
  chatId: number,
  promptMessageId: number,
  logId: string,
  action: PendingEditAction = "kcal",
): void {
  pending.set(key(chatId, promptMessageId), {
    logId,
    action,
    activeUntil: Date.now() + ACTIVE_TTL_MS,
  });
}

/** 존재 여부만 확인 (grace period 안이면 true, 즉 만료 tombstone 도 hit). */
export function isPendingEdit(
  chatId: number,
  promptMessageId: number,
): boolean {
  return pending.has(key(chatId, promptMessageId));
}

/**
 * peek — entry 정보 (logId + action + 만료 여부) 반환. **삭제하지 않음.**
 * 사용자 답장이 malformed 여도 entry 유지되어 재시도 가능 (Codex P2).
 * 만료된 경우 logId=null + expired=true.
 */
export function peekPendingEdit(
  chatId: number,
  promptMessageId: number,
): { logId: string | null; action: PendingEditAction | null; expired: boolean } {
  const entry = pending.get(key(chatId, promptMessageId));
  if (!entry) return { logId: null, action: null, expired: false };
  if (Date.now() > entry.activeUntil) {
    return { logId: null, action: null, expired: true };
  }
  return { logId: entry.logId, action: entry.action, expired: false };
}

/** 성공 처리 or 만료 안내 후 entry 명시 삭제. */
export function deletePendingEdit(
  chatId: number,
  promptMessageId: number,
): void {
  pending.delete(key(chatId, promptMessageId));
}

// 주기적 청소 — hard TTL (30분) 넘긴 entry 만 제거. grace 안 entry 는 유지해서 만료 안내 dispatch.
setInterval(() => {
  const cutoff = Date.now() - HARD_TTL_MS;
  for (const [k, v] of pending.entries()) {
    // activeUntil 은 markPendingEdit 시 = now + ACTIVE_TTL. cutoff (now - HARD_TTL) 보다 작으면
    // 즉 mark 시점이 30분 넘게 지났으면 삭제.
    if (v.activeUntil - ACTIVE_TTL_MS < cutoff) {
      pending.delete(k);
    }
  }
}, 60 * 1000).unref?.();
