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

/**
 * M1 (#377 사전 리뷰): `--to` 기본값. 선택 타입들의 oldestFetchedDate 중 **가장 늦은 값 − 1일**.
 * 병합 조건은 `endDate >= oldestFetchedDate − 1일` 이라, 가장 늦은 마커를 기준으로 잡아야
 * 모든 타입에서 첫 청크가 인접/중첩이 된다 (더 이른 마커를 가진 타입은 중첩 → LEAST 로 병합).
 * 가장 이른 값을 쓰면 늦은 타입은 disjoint+old 로 무시돼 마커가 갱신되지 않는다.
 *
 * Codex P2 (PR #379 4회차): 선택 타입 중 **하나라도 마커가 null** (#220 이전 상태 · 행 없음) 이면
 * 어제를 기준으로 한다. 다른 타입의 옛 마커를 쓰면 null 타입의 커버 범위가 그 옛 `to` 까지만
 * 초기화되고(rule 1), 이후 cron 증분 범위가 disjoint+recent 로 판정돼 마커가 최근 구간으로 리셋된다
 * (rule 3) — backfill 로 만든 마커가 버려진다. 어제 기준이면 이후 증분이 항상 인접이라 병합된다.
 * 마커 있는 타입은 어제~자기 마커 구간을 중복 fetch 하지만 upsert 라 무해하다.
 */
export function pickBackfillTo(
  oldestFetchedDates: readonly (Date | null)[],
  fallbackToday: Date,
): Date {
  const hasNull = oldestFetchedDates.some((d) => d === null);
  const latest = oldestFetchedDates
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((acc, d) => (acc === null || d > acc ? d : acc), null);
  const base = hasNull || latest === null ? fallbackToday : latest;
  return new Date(base.getTime() - DAY_MS);
}

/**
 * C1 (#377 사전 리뷰): backfill 은 `lastSyncDate` 를 뒤로 끌면 안 된다.
 * `updateSyncMetadata` 가 `lastSyncDate = endDate` 를 무조건 덮어쓰므로, 최신→과거 순 backfill 이
 * 끝나면 lastSyncDate 가 가장 오래된 청크의 end 로 남는다. weekly-report 는 startDate 없이
 * `syncAll` 을 불러 `lastSyncDate + 1` 부터 증분 싱크하므로 수년치 싱크가 폭주한다.
 * 청크마다 스냅샷과 현재값 중 늦은 쪽으로 되돌린다 (cron 이 끼어들어 더 늦은 값을 썼으면 그대로 둠).
 */
export function resolveRestoredLastSyncDate(snapshot: Date, current: Date): Date {
  return current > snapshot ? current : snapshot;
}

/**
 * Codex P1 (PR #379): lastSyncDate 스냅샷. 선택 타입에 SyncMetadata 행이 없거나(첫 싱크 전)
 * lastSyncDate 가 epoch(0) (markError/markSyncing 만 만든 행 — sync.ts 의 "성공 싱크 없음" 판정과 동일)
 * 이면 복원 기준이 없어 첫 청크가 만든 행을 이후 청크가 계속 과거로 끌어내린다.
 * 그런 타입은 backfill 의 `to`(= 첫 청크 end, backfill 후 실제 증분 경계) 를 기준으로 삼는다.
 */
export function buildLastSyncSnapshot<T extends string>(
  types: readonly T[],
  rows: readonly { dataType: string; lastSyncDate: Date }[],
  fallback: Date,
): ReadonlyMap<T, Date> {
  const byType = new Map(rows.map((r) => [r.dataType, r.lastSyncDate] as const));
  return new Map(
    types.map((t) => {
      const existing = byType.get(t);
      const hasSuccessfulSync = existing !== undefined && existing.getTime() > 0;
      return [t, hasSuccessfulSync ? existing : fallback] as const;
    }),
  );
}

/**
 * Codex P2 (PR #379): 재시도까지 실패한 타입은 더 오래된 청크에서 멈춘다.
 * 실패 청크가 커버 범위에 구멍을 내면 그보다 오래된 청크는 disjoint 라 updateSyncMetadata 가
 * 마커를 무시한다 — 데이터는 upsert 되지만 oldestFetchedDate 가 안 내려가고, 실패 청크만 재실행해도
 * 그 아래 청크의 마커는 복구되지 않는다. 멈춘 뒤 `--from=<from> --to=<실패 청크 end>` 로 재개해야
 * 연속 커버가 복원된다. 새 배열을 돌려준다 (입력 불변).
 */
export function stopFailedTypes<T extends string>(
  active: readonly T[],
  failed: readonly T[],
): T[] {
  const failedSet = new Set(failed);
  return active.filter((t) => !failedSet.has(t));
}

/**
 * Codex P2 (PR #379 3회차): 복원 대상 타입. 스냅샷이 fallback(`to`) 인 타입(행 없음/성공 싱크 없음)은
 * 이번 실행에서 한 번이라도 성공한 뒤에만 복원한다. 첫 청크가 두 번 다 실패했는데 fallback 으로
 * 올리면 다음 증분 싱크가 `to + 1` 부터 시작해 그 타입의 과거가 조용히 빈다.
 * 성공 이력이 있던 타입은 항상 복원 (끌어내린 값을 되돌리는 것이 목적).
 */
export function restorableTypes<T extends string>(
  snapshotTypes: readonly T[],
  fallbackTypes: ReadonlySet<T>,
  succeededTypes: ReadonlySet<T>,
): T[] {
  return snapshotTypes.filter((t) => !fallbackTypes.has(t) || succeededTypes.has(t));
}

/** 행이 없거나 성공 싱크가 없는(epoch) 타입 — buildLastSyncSnapshot 이 fallback 을 준 타입과 동일 판정. */
export function typesWithoutSuccessfulSync<T extends string>(
  types: readonly T[],
  rows: readonly { dataType: string; lastSyncDate: Date }[],
): Set<T> {
  const ok = new Set(rows.filter((r) => r.lastSyncDate.getTime() > 0).map((r) => r.dataType));
  return new Set(types.filter((t) => !ok.has(t)));
}

/**
 * Codex P2 (PR #379 5회차): 선택 타입별 oldestFetchedDate. 행이 없는 타입은 null 로 채운다 —
 * 조회 결과 행만 넘기면 행 없는 타입이 "null 마커" 판정에서 빠져 옛 마커 기준으로 --to 가 잡힌다.
 */
export function markersForTypes<T extends string>(
  types: readonly T[],
  rows: readonly { dataType: string; oldestFetchedDate: Date | null }[],
): (Date | null)[] {
  const byType = new Map(rows.map((r) => [r.dataType, r.oldestFetchedDate] as const));
  return types.map((t) => byType.get(t) ?? null);
}
