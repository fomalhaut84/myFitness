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

`SyncMetadata` 는 `lastSyncDate` (마지막 sync 완료 날짜) 만 tracking — **fetch 커버 범위** 는 모름. 이 정보 부족으로 아래 케이스 정확 판별 불가:

**`first === null` 케이스**:
- 시나리오 A: 사용자가 해당 dataType 아예 기록 안 함 (예: sleep 데이터 없음)
- 시나리오 B: `/api/sync?days=1` + rest day 히트로 record 0개 sync 후 lastSyncDate=today

**`first` 가 매우 오래된 케이스**:
- 시나리오 C: 예전 record 1개만 있음 → `first` 는 1년 전이라 조건 통과 (backfill skip) 하지만 실제로는 최근 90일 window 부재 (Codex bot P2 #4690182743)

**현재 fix 는 실사용 우선순위 판단**:
- 시나리오 A 보호 (record 없는 계정 매주 무의미 API 낭비 방지) — myFitness 실사용
- 시나리오 B/C — 발생 확률 낮음 (`/api/sync?days=1` 이례적)

**근본 해결**: `SyncMetadata.oldestFetchedDate` (또는 `fetchedRange` JSON) 필드 추가로 실제 fetch 커버 범위 tracking — 별도 이슈 (schema migration).
