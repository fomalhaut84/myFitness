/**
 * #377 F5: backfill 청크 분할 (순수 함수). scripts/backfill-history.ts 가 사용.
 *
 * [from, to] 를 **최신 → 과거** 순 chunkDays 청크로 나눈다. #220 의 SyncMetadata 병합 규칙이
 * "기존 커버 범위와 인접/중첩일 때만 병합" 이라, 최신 청크부터 붙여야 oldestFetchedDate 가
 * 한 청크씩 과거로 당겨진다. 과거→최신 순이면 마지막 청크만 병합돼 마커가 틀린다.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export const BACKFILL_CHUNK_DAYS = 365;

export interface BackfillChunk {
  index: number;
  start: Date;
  end: Date;
}

export function buildBackfillChunks(
  from: Date,
  to: Date,
  chunkDays: number = BACKFILL_CHUNK_DAYS,
): BackfillChunk[] {
  if (chunkDays < 1) throw new Error("chunkDays 는 1 이상");
  const chunks: BackfillChunk[] = [];
  let end = to;
  let index = 0;
  while (end >= from) {
    const candidate = new Date(end.getTime() - (chunkDays - 1) * DAY_MS);
    const start = candidate < from ? from : candidate;
    chunks.push({ index, start, end });
    end = new Date(start.getTime() - DAY_MS);
    index += 1;
  }
  return chunks;
}
