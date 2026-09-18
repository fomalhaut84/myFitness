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

/**
 * Codex P1 (PR #386): 단조 증가는 **미래 endDate 를 되돌릴 수단도 없앤다.** `/api/sync` 가 유효한 미래 날짜를 통과시키면
 * range fetcher 는 성공하고 커서가 미래로 저장돼, 이후 cron/리포트의 `lastSyncDate + 1` 증분이 그 날짜가 올 때까지 gap-fill 을
 * 건너뛴다. 경계(`/api/sync`)에서 거부하고, 여기서도 커서를 오늘(KST 자정)로 clamp 한다 (이중 방어).
 */
export function clampCursorToToday(endDate: Date, todayKstMidnight: Date): Date {
  return endDate.getTime() > todayKstMidnight.getTime() ? todayKstMidnight : endDate;
}

/** 조건부 전진 predicate — `updateMany` 가 이 where 로 기존 값보다 늦은 cursor 만 쓴다 (atomic). cursor 는 clamp 된 값. */
export function advanceLastSyncDateWhere(
  dataType: string,
  cursor: Date,
): { dataType: string; lastSyncDate: { lt: Date } } {
  return { dataType, lastSyncDate: { lt: cursor } };
}

/** 같은 규칙의 순수 버전 — 결과값 확인용 (테스트·문서). */
export function resolveNextLastSyncDate(current: Date, cursor: Date): Date {
  return cursor.getTime() > current.getTime() ? cursor : current;
}
