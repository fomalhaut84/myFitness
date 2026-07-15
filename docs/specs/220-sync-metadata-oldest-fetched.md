# [chore] SyncMetadata.oldestFetchedDate 근본 fix

- **작성일**: 2026-07-15
- **이슈**: #220
- **선행**: #209 (PR #218, PR #219) — syncAll.minHistoryDays 옵션 도입
- **범위**: SyncMetadata schema 확장 + syncAll 판정 로직 변경 (backfill 정확도 향상)

## 배경

#209 에서 `syncAll.minHistoryDays` 로 backfill 강제 옵션 도입. 그러나 SyncMetadata 는 `lastSyncDate` (마지막 sync 완료 날짜) 만 tracking 하고 **실제 fetch 커버 범위**를 모름. 이로 인해:

- 시나리오 A: DB record 자체 없음 (사용자가 기록 안 함) → 매주 backfill 호출은 무의미 (Codex bot P2 #4690117542)
- 시나리오 B: 짧게 sync 후 record 0개, 이전 데이터 존재 가능성 → backfill 필요
- 시나리오 C: 오래된 record 1개 존재, 최근 90일 window 부재 → backfill 필요

기존 코드는 `firstRecordDate()` (DB 에 실제 존재하는 최초 record) 로 우회 판정. 하지만 시나리오 A 를 제대로 구분 못 함 (Codex 지적 우회 시 무한 API 호출 위험).

## 목표

SyncMetadata 에 `oldestFetchedDate` 필드를 추가해서 **실제 sync API 로 커버한 범위** 를 정확히 tracking. `firstRecordDate()` 는 fallback 으로만 사용.

## 요구사항

- **F1**: `SyncMetadata.oldestFetchedDate DateTime?` 필드 추가 + 수동 SQL migration (기존 record 는 null)
- **F2**: `updateSyncMetadata(dataType, startDate, endDate, syncCount, error?)` 파라미터에 startDate 추가.
  - `oldestFetchedDate = MIN(prev, startDate)`
  - `prev === null` (마이그레이션 첫 write) 시 `MIN(startDate, firstRecordDate())` 로 seed (pre-#220 record 커버 반영)
  - `user_profile` 은 date 없음 → undefined 로 미변경
- **F3**: `historyShortfall` 판정을 `oldestFetchedDate > requiredStart` 로 변경 (record 유무 무관).
  - Fallback: `oldestFetchedDate === null` 이면 `firstRecordDate()` (첫 실행 사이클 한정)
  - 여전히 `null` 이면 (record 없음) shortfall = false 유지 (Codex P2 정책)

## 기술 설계

### oldestFetchedDate 수렴 시나리오

**semantic**: `oldestFetchedDate` 는 **실제 sync API 호출 startDate** 만 반영 (record 존재 ≠ API 커버). Codex bot P2 (PR #240 #4700366975) 로 firstRecordDate seed 제거.

| 시점 | 상태 | 동작 |
|---|---|---|
| pre-#220 record + 어떤 데이터든 존재 | `oldest=null`, `first=D-N` | shortfall check: `first !== null` → shortfall=true → backfill (startDate=D-90). LEAST UPDATE 로 `oldest=D-90` 정착 |
| 신규 계정 (record 없음, 성공 sync) | `oldest=null`, `first=null` | shortfall=false (record 없음 = 무한 API 호출 방지). 정상 incremental sync → `oldest=lastSyncDate+1` |
| 마이그레이션 이후 정상 사이클 | `oldest=D-90` | requiredStart=D-90 → shortfall=false. 시간 흐름에 따라 새 window 요구 시 자연 backfill |
| Codex P2 재현 케이스 (오래된 record + 짧은 sync) | `oldest=null`, `first=D-365`, 최근 7일만 fetch | shortfall check: `first !== null` → shortfall=true → backfill 90일 fetch → `oldest=D-90` 정확 정착 (D-365 로 오인 X) |

### 회귀 안전성

- `updateSyncMetadata` 는 sync.ts 내부 non-exported 함수. 유일 호출부만 새 signature 적용.
- markSyncing/markError 의 create fallback 은 `oldestFetchedDate` 미터치 (null 유지). 다음 성공 sync 에서 seed.
- Migration nullable ADD COLUMN 이라 lock 대기/데이터 변경 없음.

### 동시성 안전성 (Codex bot P2 대응, PR #239)

`oldestFetchedDate` 는 별도 **atomic UPDATE** 로 갱신 (표준 필드 upsert 와 분리):

```sql
UPDATE "SyncMetadata"
SET "oldestFetchedDate" = LEAST(COALESCE("oldestFetchedDate", $candidate), $candidate)
WHERE "dataType" = $dataType
```

Read-modify-write 대신 SQL `LEAST` 로 monotonic 보장. 재현 시나리오:

1. Weekly `preSync` (cron) 이 `minHistoryDays=90` 으로 시작 → startDate = D-90.
2. 동시에 `/api/sync` 수동 호출 (isSyncing guard 를 우회하는 별도 프로세스) startDate = D-1.
3. 각 호출은 upsert 후 별도 atomic UPDATE 실행. 순서 무관하게 최종 `oldestFetchedDate = min(D-90, D-1) = D-90` 로 정착.

Prior 구현 (read-modify-write) 은 후 write 가 D-1 로 덮어쓰면 backfill 이력 손실 → 다음 주 반복.

## 변경 파일

- `prisma/schema.prisma` — SyncMetadata.oldestFetchedDate
- `prisma/migrations/20260715013841_sync_metadata_oldest_fetched/migration.sql`
- `src/lib/garmin/sync.ts` — updateSyncMetadata 확장, historyShortfall 판정 변경

## 테스트 계획

프로젝트 test framework 부재 → 시나리오 트레이스로 검증 (docs 명시):
- pre-#220 (oldest=null) + 데이터 충분 → 첫 사이클: fallback shortfall=false, 이후 seed 정착
- pre-#220 + 데이터 부족 → backfill 1회 후 정착
- record 없는 계정 → shortfall 절대 발생 X (무한 API 호출 방지)
- 신규 dataType (fresh install) → bootstrapNewTypes 로 365일 로드 후 seed
- syncCount=0 (빈 sync 성공) → oldestFetchedDate 정상 기록

## 제외

- `updateSyncMetadata` 에 `prev` 파라미터 전달로 findUnique round-trip 절약 (성능 개선, 별도)
- oldestFetchedDate 초기 seed 를 별도 script (`scripts/backfill-sync-metadata.ts`) 로 마이그레이션 시점에 실행 — 대신 lazy 로 첫 syncAll 시 초기화
