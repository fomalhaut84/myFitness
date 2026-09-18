/**
 * #381: SyncMetadata.lastSyncDate 단조 증가 규칙 (순수 · prisma 없음 — verify 스크립트가 공유).
 *
 * 이전 `updateSyncMetadata` 는 `lastSyncDate = endDate` 를 무조건 덮어썼다. 그래서
 * - 과거 범위 명시 싱크(backfill 청크 · /api/sync 옛 범위)가 증분 커서를 수년 뒤로 끌었고,
 * - backfill 스크립트가 스냅샷/복원으로 막는 사이 cron 이 전진시킨 값을 backfill 의 덮어쓰기가
 *   지운 뒤 복원이 스냅샷으로 되돌려 cron 전진분이 사라졌다 (릴리즈 PR #380 Codex P2).
 *
 * 규칙: `lastSyncDate` 는 **기존 값보다 늦을 때만** 갱신한다 (`oldestFetchedDate`/`coveredThroughDate`
 * 가 atomic UPDATE + CASE 로 다루는 것과 같은 방식). 뒤로 가야 하는 시나리오는 없다 — 옛 범위 재수신은
 * upsert 로 데이터만 채우고, 커버 범위 부족은 #220 마커(`historyShortfall`)가 따로 잡는다.
 * backfill 스크립트의 스냅샷/복원(C1)은 이중 안전으로 유지한다.
 */

/** 조건부 전진 predicate — `updateMany` 가 이 where 로 기존 값보다 늦은 endDate 만 쓴다 (atomic). */
export function advanceLastSyncDateWhere(
  dataType: string,
  endDate: Date,
): { dataType: string; lastSyncDate: { lt: Date } } {
  return { dataType, lastSyncDate: { lt: endDate } };
}

/** 같은 규칙의 순수 버전 — 결과값 확인용 (테스트·문서). */
export function resolveNextLastSyncDate(current: Date, endDate: Date): Date {
  return endDate.getTime() > current.getTime() ? endDate : current;
}
