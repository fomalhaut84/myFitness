// #440: Garmin 활동 스플릿 (km 랩) 조회 — `/api/activities/[id]/splits` route 와 AI 평가 로더가 공유한다.
// km 랩은 DB `splitSummaries` (RWD / INTERVAL 요약) 에 없어 활동마다 API 1회가 필요하다.
import { withReauth } from "./client";

const SPLITS_URL = (garminId: bigint) => `https://connectapi.garmin.com/activity-service/activity/${garminId}/splits`;

/** 원자료 lapDTO 배열 — 검증은 호출자 (`toEvalLaps` · `SplitChart`) 몫. 재인증 · 레이트리밋 실패는 예외로 올린다. */
export async function fetchActivitySplits(garminId: bigint): Promise<unknown[]> {
  const splits = await withReauth((client) => client.get<{ lapDTOs?: unknown[] } | null>(SPLITS_URL(garminId)));
  return Array.isArray(splits?.lapDTOs) ? splits.lapDTOs : [];
}
