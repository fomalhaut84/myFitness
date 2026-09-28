// #396: Garmin activity rawData 의 `eventType.typeKey` ("race" · "training" · "uncategorized" …) 추출.
// sync fetcher 와 backfill 스크립트가 공유 — 값은 Garmin 원문 그대로 두고 해석 (레이스 여부) 은 소비처가 한다.

export const RACE_EVENT_TYPE = "race";

/** rawData → eventType 문자열. 필드 누락 · 비문자열 · 빈 문자열은 null. */
export function parseEventType(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const event = (raw as { eventType?: unknown }).eventType;
  if (!event || typeof event !== "object") return null;
  const key = (event as { typeKey?: unknown }).typeKey;
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}
