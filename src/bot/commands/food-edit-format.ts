// #350 / Codex P2 (PR #351): 식단 편집 응답 메시지 조립. 의존성 없는 순수 모듈 —
// scripts/verify-food-edit-pending.ts 에서 길이 상한을 회귀 검증한다.
//
// `FoodLog.description` 은 스키마에 길이 제한이 없다 (PATCH API 만 500자 제한, 생성·Vision
// 경로는 무제한). 긴 설명을 그대로 실으면 Telegram 한도(4096자)를 넘겨 sendMessage 가
// 거부되는데, 특히 이전/새 설명을 함께 싣는 설명 변경 완료 응답에서 터진다. 그 시점엔 DB
// update 가 이미 커밋된 뒤라 사용자는 복구 안내를 잃고 수정이 실패한 것으로 오인하게 된다.

/** Telegram sendMessage 본문 한도. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** 메시지에 삽입할 설명 미리보기 길이. */
export const DESC_PREVIEW_MAX = 120;

/** 설명을 메시지 삽입용으로 자른다. 초과분은 말줄임표로 대체. */
export function descPreview(description: string): string {
  return description.length > DESC_PREVIEW_MAX
    ? `${description.slice(0, DESC_PREVIEW_MAX)}…`
    : description;
}

/** 설명 변경 완료 응답. 이전 설명을 함께 실어 오소비 시 복구 경로를 제공한다 (#350 F10). */
export function buildDescChangeMessage(
  previousDescription: string,
  newDescription: string,
): string {
  return (
    `📝 설명 변경 완료: "${descPreview(newDescription)}"\n` +
    `이전 설명: "${descPreview(previousDescription)}" (잘못 바뀐 경우 [📝 설명] 로 되돌리세요)\n` +
    `kcal/매크로는 backfill cron 이 곧 재추정합니다.`
  );
}

/** kcal 정정 완료 응답. */
export function buildKcalChangeMessage(
  description: string,
  kcal: number,
): string {
  return `✏️ "${descPreview(description)}" → ${kcal.toLocaleString("ko-KR")} kcal 로 수정됨`;
}
