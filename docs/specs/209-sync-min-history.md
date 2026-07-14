# M#209: Weekly preSync — 짧은 history 감지 시 backfill

- **작성일**: 2026-07-14
- **타입**: chore/infra
- **이슈**: #209
- **참조**: Codex bot review PR #205 #4681878923

## 1. 배경

`syncAll` 은 `bootstrapNewTypes: true` 로 신규 타입 (성공 sync 이력 없음) 은 365일 초기 로드. 하지만 이미 짧은 sync (예: `/api/sync` 1일 range) 이 있으면 `hasSuccessfulSync=true` 라 bootstrap 무효 → `lastSyncDate + 1` 부터 증분만.

Weekly prompt 는 `get_pace_progression` (90일), `get_training_load_trend` (28일), `get_injury_risk_score` (28일) 등 긴 window 도구 요구 → history 부족 시 부정확 결과.

## 2. 목표

기존 성공 sync 있어도 firstRecordDate 가 요구 window 미만이면 강제 backfill.

## 3. 요구사항

- [x] **F1**: `syncAll` 에 `minHistoryDays?: number` 옵션 추가.
- [x] **F2**: dataType 별 최초 record 날짜 (`firstRecordDate`) 조회 helper.
- [x] **F3**: `firstRecordDate` 가 `today - minHistoryDays` 이후 (=history 부족) 이면 `startDate = daysAgo(minHistoryDays)` 로 강제.
- [x] **F4**: Weekly preSync 에서 `minHistoryDays: 90` 지정 (가장 큰 요구 window).

## 4. 설계

### `firstRecordDate(dataType)` helper

- `daily_stats` / `sleep` / `heart_rate` / `body_composition` / `blood_pressure` — Prisma 각 모델의 `date` 필드 min
- `activities` — `startTime` 필드 min
- `user_profile` — 스냅샷이라 무관 → null 반환

### `syncAll` 로직 흐름

```
if (!hasSuccessfulSync && bootstrapNewTypes) → 365일
else if (historyShortfall && minHistoryDays) → daysAgo(minHistoryDays)
else if (options.startDate) → 명시
else if (hasSuccessfulSync) → incremental (lastSyncDate + 1)
else → 365일 (신규 타입 명시 없음)
```

**`bootstrapNewTypes` vs `minHistoryDays`**:
- `bootstrapNewTypes`: 성공 sync 이력 자체가 **없을 때** (신규 타입)
- `minHistoryDays`: 성공 sync 있지만 **history 부족할 때**

## 5. 변경 파일

- `src/lib/garmin/sync.ts` — `firstRecordDate` helper + `minHistoryDays` 옵션
- `src/lib/weekly-report.ts` — Step 1b syncAll 에 `minHistoryDays: 90` 지정

## 6. 검증

- 3-check (lint / typecheck) 통과
- 배포 후: `/api/sync` 짧게 실행 후 weekly cron → history 부족 감지 → backfill 로그

## 7. 제외

- 각 dataType 별로 다른 required window 지정 (예: activities 90일, injury_risk 28일) — 가장 큰 값 (90일) 하나로 통일 (실용).
- `firstRecordDate` 캐싱 — 매번 조회 (Prisma index 로 빠름).

## 8. Known limitations

**`first === null` 케이스 판별 불가**:
- 시나리오 A: 사용자가 해당 dataType 을 아예 기록 안 함 (예: sleep 데이터 없음)
- 시나리오 B: `/api/sync?days=1` + rest day 히트로 record 0개 sync 후 lastSyncDate=today

현재 fix 는 A 보호 (매주 무의미 API 낭비 방지). B 는 발생 확률 낮음 (Codex bot P2 #4690151369 지적).

근본 해결은 `SyncMetadata.oldestFetchedDate` 필드 추가로 실제 fetch 커버 범위 tracking — 별도 이슈 (schema migration).
