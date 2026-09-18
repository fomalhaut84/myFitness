# backfill 중 동시 싱크의 lastSyncDate 전진분 손실 — updateSyncMetadata 를 단조 증가로

- **작성일**: 2026-09-18
- **타입**: fix
- **이슈**: #381 (릴리즈 PR #380 Codex P2 · PR #379 후속)
- **관련**: #377 스펙 §4.5, `scripts/backfill-history.ts` C1 복원

## 1. 배경

`updateSyncMetadata` 는 `lastSyncDate = endDate` 를 **무조건** 덮어썼다. backfill 스크립트는 청크·타입 단위로
`syncAll` 을 돌린 뒤 스냅샷으로 되돌려 이를 막았지만, backfill 이 진행 중인 타입의 `syncAll` 이 끝나기 전에
cron/수동 싱크가 같은 타입의 `lastSyncDate` 를 오늘로 전진시키면:

1. backfill 의 `updateSyncMetadata` 가 `lastSyncDate = <청크 옛 endDate>` 로 덮어쓰고
2. 복원은 덮어써진 값만 보므로 `resolveRestoredLastSyncDate(snapshot, current)` 가 **스냅샷**으로 되돌린다
   → cron 의 전진분이 사라진다.

손실 폭은 대개 하루 이내라 다음 증분이 그만큼 재조회할 뿐 데이터 손실은 없다. 다만 같은 계열(C1 · 5회차 P1)을
스크립트 쪽에서 계속 막는 구조라 근본 지점에서 닫는다.

## 2. 수정

- [x] `src/lib/garmin/sync-metadata.ts` (순수) — `advanceLastSyncDateWhere(dataType, endDate)` = `{ dataType, lastSyncDate: { lt: endDate } }`, `resolveNextLastSyncDate(current, endDate)`.
- [x] `src/lib/garmin/sync.ts` `updateSyncMetadata` — upsert 의 `update` 에서 `lastSyncDate` 제거, 이어서 `updateMany({ where: advanceLastSyncDateWhere(...), data: { lastSyncDate: endDate } })` 로 **기존 값보다 늦을 때만** 갱신 (atomic 조건부 UPDATE — `oldestFetchedDate`/`coveredThroughDate` 의 CASE 와 같은 방식). `create` 는 그대로 `endDate`.
- [x] backfill 스크립트의 스냅샷/복원(C1) 은 **이중 안전으로 유지** (주석에 #381 이후 위상 명시). "이중 안전" 은 **(a) 청크가 최신→과거 순이라 chunk0.end == `to` == fallback 스냅샷 기준, (b) chunk0 실패 타입은 `stopFailedTypes` 로 중단** 이라는 두 전제 위에서만 성립한다 — 둘 중 하나라도 바꾸면 epoch(0) 타입의 커서가 과거 청크 end 로 올라간 채 남아 C1 사고가 재현되므로 복원 로직을 "중복" 으로 보고 지우지 말 것 (사전 리뷰 info 4).
- [x] 문서: #377 스펙 §4.5 · `backfill-history.ts` 헤더 · `backfill-chunks.ts` 주석.
- [x] 회귀 검증: `scripts/verify-mcp-long-history.ts` [12] — predicate 가 `lt`, 순수 규칙, 그리고 `sync.ts` 소스 스캔(upsert `update` 블록에 `lastSyncDate` 재유입 0건 · `advanceLastSyncDateWhere` 사용).

## 3. 뒤로 가야 하는 시나리오 검토

`/api/sync` 로 **의도적으로** 옛 범위만 다시 받는 경우, 이전엔 `lastSyncDate` 가 옛 endDate 로 내려가 다음
증분이 그 범위부터 다시 돌았다. 이것이 의도였는지 확인:

- weekly-report 주석의 Codex P2 이력은 반대 방향(실패 타입에 explicit 1일 range 가 성공해 `lastSyncDate=today` 로
  올라가 365일 backfill 이 영구 skip) 이다 — 뒤로 가는 것에 의존하는 경로가 아니다.
- 커버 범위 부족은 #220 마커(`oldestFetchedDate`/`coveredThroughDate` + `minHistoryDays` 의 `historyShortfall`)가
  따로 잡는다. 증분 커서를 뒤로 끌어 재조회하는 것은 마커 도입 전 우회였다.
- 옛 범위 재수신은 upsert 라 커서와 무관하게 데이터가 채워진다.

→ 뒤로 가야 하는 시나리오 없음. 단조 증가 확정. 옛 범위부터 "다시 증분" 이 필요하면 `/api/sync` 에 `startDate` 를
명시하는 것이 정본이다.

## 4. 제외

- 감사 D-2 (복원력: 429 백오프 · 타임아웃 · 토큰 권한) — 별도 이슈.
- backfill 스크립트 변경 없음 (주석만).
