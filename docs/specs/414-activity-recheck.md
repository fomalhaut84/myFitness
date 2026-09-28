# [후속 #414] 과거 활동 메타 재조회 — 활동 타입 최근 N일 되돌아보기

- **작성일**: 2026-09-28
- **타입**: fix (bug · P2)
- **이슈**: #414 (PR #412 Codex 3회차 P2)
- **브랜치**: `fix/414-1` (dev → dev)
- **의존**: #396 (`Activity.eventType`) · #381 (`lastSyncDate` 단조 증가) · #377 (`backfill:history`)

## 1. 배경 (2026-09-28 실코드 재검증)

활동 fetcher 의 upsert `update` 에는 `eventType` · `name` · `activityType` 이 전부 들어 있어 **다시 가져오기만 하면** 갱신된다. 문제는 재조회 범위다.

- 이슈 본문은 "증분 싱크 = `lastSyncDate + 1`" 이라 했지만, 실제 매일 06:00 cron 은 **명시 3일 창** (`startDate: daysAgoKST(3)` · `src/lib/cron.ts`) 으로 돈다. 리포트 전 싱크는 1일, 봇 `/sync` 는 어제~오늘. `lastSyncDate + 1` 경로는 `startDate` 없는 호출 (주간 리포트 step1b) 에서만 탄다.
- 따라서 **3일보다 오래된 활동**을 워치 · Garmin Connect 에서 레이스로 바꾸거나 이름 · 유형을 고쳐도 DB 는 그대로다. `RaceTable` 의 "다음 싱크에 반영됩니다" 는 최근 3일 안의 활동에만 참.
- 활동 목록 API (`getActivities(start, limit)`) 는 최신순 페이지네이션 (20건) 이고 fetcher 는 `activityDate < startDate` 에서 멈춘다 — 창을 30일로 넓히면 페이지 2~3개 (API 호출 +1~2 · 각 `API_DELAY_MS` 대기) 가 더 든다. 하루 1회 cron 에서 무시할 비용.
- 그보다 오래된 활동은 이미 명시 재조회 경로가 있다: `npm run backfill:history -- --types=activities --from=YYYY-MM-DD --to=YYYY-MM-DD` (청크 1개 · upsert 로 메타 갱신 · `lastSyncDate` 는 스냅샷/복원 + 단조 규칙으로 보호).

## 2. 목표

1. 매일 cron 과 봇 `/sync` 가 **활동 타입만 최근 30일**을 되돌아본다 — 그 안의 레이스 표시 · 이름 · 유형 변경이 다음 싱크에 반영된다.
2. 리포트 전 싱크 (1일) · 백필 청크 · `/api/sync` 명시 범위는 그대로 (옵션이 없으면 동작 불변).
3. UI 문구가 실제 동작을 말한다: "최근 30일 안의 활동은 다음 싱크에, 더 오래된 활동은 `backfill:history --types=activities` 로".

## 3. 요구사항

- [x] F1 `src/lib/garmin/activity-recheck.ts` (순수): `ACTIVITY_RECHECK_DAYS = 30` · `activityRecheckStart(startDate, today, days)` — `today − days` 가 `startDate` 보다 앞이면 그 값, 아니면 `startDate` 그대로 (창을 넓히기만 한다 · 좁히지 않는다).
- [x] F2 `syncAll` 옵션 `activityRecheckDays?: number` — `activities` 타입에만, startDate 결정 뒤 · "이미 최신" 판정 앞에 적용. 넓혔으면 로그 한 줄.
- [x] F3 호출자: `src/lib/cron.ts` (3일 창) · `src/bot/commands/sync.ts` (수동) 에 `activityRecheckDays: ACTIVITY_RECHECK_DAYS`. 리포트 전 싱크 · 백필 · `/api/sync` 는 넘기지 않는다.
- [x] F4 `RaceTable` 빈 상태 · 캡션 · `EventList` 빈 상태 문구 정정 (상수에서 일수).
- [x] F5 회귀 테스트 `activity-recheck.test.ts`: 창 확장 · 이미 더 이른 startDate 는 유지 · 0/음수 일수는 무변경 · 입력 불변.
- [x] F6 스펙 396 §7 · 로드맵 M15-4 반영.

## 4. 기술 설계

- `lastSyncDate` 는 단조 증가 (#381) 라 startDate 를 앞당겨도 커서가 뒤로 가지 않는다. `oldestFetchedDate` 는 겹침 병합 (`LEAST`) 이라 변화 없음.
- fetcher 의 부수 효과는 DB 만 (`parseAndSaveWristTemps` · 강도 재계산은 rawData 에서 같은 값). `hrr2` · 기상 컬럼은 `data` 에 없어 건드리지 않는다. 싱크 뒤 `fillRecoveryColumns` 창이 `recoveryFrom = startDate − 2일` 로 30일이 되지만 DB 조회만 (수 건 갱신 · 대부분 이미 채워짐).
- 옵션 방식을 택한 이유: `syncAll` 안에서 무조건 넓히면 리포트 전 싱크 (하루 2회 · 지연 민감) 와 백필 청크 (명시 범위 존중) 까지 바뀐다. 호출자가 의도를 넘긴다.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/garmin/activity-recheck.ts` (+ `__tests__/activity-recheck.test.ts`) | 신규 · 순수 |
| `src/lib/garmin/sync.ts` | `activityRecheckDays` 옵션 |
| `src/lib/cron.ts` · `src/bot/commands/sync.ts` | 옵션 전달 |
| `src/components/trends/RaceTable.tsx` · `EventList.tsx` | 문구 |
| `docs/specs/396-highlights.md` · `docs/roadmap.md` | 후속 반영 |

## 6. 테스트 계획

§3 F5 + 4종 검증. 로컬 dev DB 는 2026-04 스냅샷이라 실 API 창 확장은 배포 후 `pm2 logs` 의 `[activities] 싱크 시작: <오늘−30일> ~ <오늘>` 로 확인.

## 7. 제외 사항

- 활동 **삭제** 반영 (Garmin 에서 지운 활동이 DB 에 남음) — 목록 비교가 필요, 별도 이슈.
- 30일보다 오래된 활동의 자동 재조회 — 비용 대비 드문 경우. 명시 경로 (`backfill:history`) 로.
- `/api/sync` 에 옵션 노출 — 명시 범위 API 라 불필요.
