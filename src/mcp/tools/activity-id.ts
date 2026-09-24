// #444: 활동 id 해석 — `get_activity_splits` · `get_activity_context` 공용. DB id(cuid) 또는 Garmin garminId 문자열.

// PostgreSQL bigint 범위 (signed 64-bit)
const BIGINT_MAX = BigInt("9223372036854775807");
const BIGINT_ZERO = BigInt(0);

/** activityId 문자열을 BigInt garminId 로 안전 변환 (범위 초과/포맷 오류 시 null) */
export function tryParseGarminId(activityId: string): bigint | null {
  if (!/^\d+$/.test(activityId)) return null;
  try {
    const value = BigInt(activityId);
    if (value > BIGINT_MAX || value < BIGINT_ZERO) return null;
    return value;
  } catch {
    return null;
  }
}

export type ActivityLookupClause = { id: string } | { garminId: bigint };

/** `where: { OR: ... }` 절 — cuid 는 항상, 숫자면 garminId 도 */
export function activityLookupClauses(activityId: string): ActivityLookupClause[] {
  const garminId = tryParseGarminId(activityId);
  return garminId === null ? [{ id: activityId }] : [{ id: activityId }, { garminId }];
}

/** MCP 도구 오류 응답 (isError) */
export function errorPayload(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}
