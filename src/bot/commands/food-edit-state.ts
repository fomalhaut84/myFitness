// #292 (M14 Phase 2 #1): 봇 [수정] 버튼 클릭 → force_reply 프롬프트 대기 상태 저장.
// - 봇이 프롬프트 메시지 (예: "새 kcal 을 답장해주세요") 를 보내면, 그 messageId 를 key 로
//   대상 FoodLog id + 만료 시각을 map 에 등록.
// - 사용자가 그 프롬프트에 reply → message:text 핸들러가 reply_to_message.message_id 를 조회해
//   pending 인지 확인 → 있으면 kcal 파싱 후 반영.
// - 단일 사용자 · 단일 프로세스 시나리오라 in-memory Map 충분. 재시작 시 삭제되지만 5분 TTL
//   이내에 답장 안 하면 어차피 무효 처리하므로 실질 영향 없음.

const TTL_MS = 5 * 60 * 1000;

interface PendingEdit {
  logId: string;
  expiresAt: number;
}

const pending = new Map<number, PendingEdit>();

/** 프롬프트 메시지 id 를 key 로 log id 를 저장. TTL 5분. */
export function markPendingEdit(promptMessageId: number, logId: string): void {
  pending.set(promptMessageId, {
    logId,
    expiresAt: Date.now() + TTL_MS,
  });
}

/**
 * reply 대상 메시지가 pending 이면 log id 반환 + 소비 (map 제거).
 * 만료된 항목은 소비하지 않고 null 반환 (호출측이 '만료' 메시지 응답).
 */
export function consumePendingEdit(promptMessageId: number): {
  logId: string | null;
  expired: boolean;
} {
  const entry = pending.get(promptMessageId);
  if (!entry) return { logId: null, expired: false };
  pending.delete(promptMessageId);
  if (Date.now() > entry.expiresAt) {
    return { logId: null, expired: true };
  }
  return { logId: entry.logId, expired: false };
}

/**
 * 프롬프트 메시지 id 가 pending 항목인지 (만료 여부 무관, 존재만 확인).
 * 사전 리뷰 P1 (#292): 만료 판정은 consumePendingEdit 로 위임 — 만료 entry 도 dispatch 되어야
 * 사용자에게 '요청이 만료되었습니다' 안내가 도달 (그렇지 않으면 AI fallback 으로 흘러감).
 */
export function isPendingEdit(promptMessageId: number): boolean {
  return pending.has(promptMessageId);
}

// 주기적 청소 — 만료된 항목 제거. bot 프로세스 lifetime 동안 map size 제어.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending.entries()) {
    if (now > v.expiresAt) pending.delete(k);
  }
}, 60 * 1000).unref?.();
