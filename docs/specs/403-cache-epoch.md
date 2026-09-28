# [후속 #403] 히스토리 캐시 — 프로세스 간 무효화 신호 (DB epoch)

- **작성일**: 2026-09-28
- **타입**: chore (P2)
- **이슈**: #403 (PR #402 Codex P2 4회차 · 394 스펙 §4.6 트레이드오프)
- **브랜치**: `fix/403-1` (dev → dev)
- **의존**: #394 (`cache-core.ts` · `cache.ts`)

## 1. 배경 (2026-09-28 실코드 재검증 — 유효)

summary 메모리 캐시 키 = `<호출자 키>|<syncStamp>|<version>`. `syncStamp` 는 `max(SyncMetadata.lastSyncAt)` (DB · 모든 프로세스가 본다), `version` 은 **Next 프로세스 메모리**의 수동 쓰기 카운터. 봇 프로세스 (`myfitness-bot`) 가 쓴 변경은 version 을 못 올려 연·월 뷰에 최대 TTL (10분) 늦게 반영된다.

1. 봇 식단 기록 (`src/bot/commands/food*.ts` 의 `foodLog` create · update · delete) → `intakeKcal` · `calorieBalance`. 봇 명령은 `bumpHistoryCacheVersion` 자체를 부르지 않는다 (불러도 봇 프로세스 메모리).
2. 봇이 부른 `syncAll` 의 daily-summary fetcher 가 `targetCalories` 를 처음 세팅 → `recalculateAllCalorieBalances()` 백그라운드. `lastSyncAt` 은 재계산 전에 갱신되므로 웹이 **부분 재계산 값**을 최종 stamp 로 캐시할 수 있고, 완료 시점의 bump 는 봇 메모리만 올린다.

## 2. 목표

DB 에 보이는 무효화 신호 하나 (**epoch**) 를 stamp 에 합친다. 어느 프로세스에서 쓰든 `bumpHistoryCacheVersion()` 이 epoch 를 갱신하고, 웹의 `getSyncStamp` (5초 재사용) 가 다음 조회에서 새 키를 쓴다. 스키마 변경 없음 — 기존 `SystemAlertState` key-value 행 재사용 (weather lock 과 같은 패턴).

## 3. 요구사항

- [x] F1 `cache-core.ts` `composeSyncStamp(lastSyncAt, epoch)` (순수) — 둘 다 null 허용 · 어느 쪽이 바뀌어도 다른 문자열.
- [x] F2 `cache-epoch.ts` (서버): `HISTORY_CACHE_EPOCH_ALERT_TYPE = "history_cache_epoch"` · `readHistoryCacheEpoch()` (`lastAlertAt` · 행 없으면 null) · `touchHistoryCacheEpoch()` (upsert `lastAlertAt = now` · 실패는 로그만).
- [x] F3 `cache.ts`: `getSyncStamp` = `Promise.all([max lastSyncAt, epoch])` → `composeSyncStamp` (요청당 쿼리 1 → 2 · 5초 memo 그대로). `bumpHistoryCacheVersion()` 은 in-process bump + `touchHistoryCacheEpoch()` fire-and-forget (await 하지 않는다 — 호출자 응답 지연 없음).
- [x] F4 봇 식단 경로 **6곳** 의 재계산 블록을 `withHistoryCacheBump` 로 감싼다 — `food.ts` 기록 (`recalcWithRetry`) · `/food_kcal` 보정 · `food-photo.ts` 기록 · `food-edit-callback.ts` 삭제 · kcal 보정 · 설명 수정. bump 는 **재계산 뒤** (사전 리뷰 major 2: 먼저 bump 하면 재계산 전 값이 새 키로 캐시). kcal 보정 2곳은 `applyKcalCorrection` (lib) 안에서 쓰므로 처음 grep 에서 빠졌다 (major 1).
- [x] F5 회귀 테스트: `cache.test.ts` — `composeSyncStamp` (epoch 만 바뀌어도 재조회 · null 조합) · `runThenBump` (재계산 → bump 순서 · 던져도 bump) · 기존 stamp 테스트 유지.
- [x] F6 로드맵 M15-2 후속 표기 · 394 스펙 §4.6 처리 표기.

## 4. 기술 설계

- epoch 값은 `SystemAlertState.lastAlertAt` (ms 정밀). 같은 ms 안의 두 쓰기는 같은 값 — 그 창의 두 번째 쓰기는 다음 조회가 아니라 5초 memo 만료 뒤에 보인다 (TTL 10분 → 최대 5초 · 수용).
- 2번 경로: `recalculateAllCalorieBalances` 의 `finally` 가 이미 `bumpHistoryCacheVersion()` 을 부른다 → epoch 갱신으로 웹 키가 바뀌어 부분 값 캐시가 폐기된다.
- 봇 경로도 같은 순서 (`runThenBump` · `withHistoryCacheBump`): 쓰기 → 재계산 (실패 시 stale 큐) → bump. 재계산이 실패해 stale 큐로 넘어가면 cron (Next 프로세스) 이 재계산 뒤 `finally` 에서 bump 한다.
- `bumpHistoryCacheVersion` 을 부르는 웹 route 들 (체중 · 식단 · cron · sync · calorie-balance) 은 코드 변경 없이 epoch 도 올린다.
- 대안 (fetcher 에서 재계산 await) 은 2번만 풀고 싱크를 수 초 늦춘다 — 채택 안 함.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/history/cache-core.ts` (+ `__tests__/cache.test.ts`) | `composeSyncStamp` |
| `src/lib/history/cache-epoch.ts` | 신규 (서버) |
| `src/lib/history/cache.ts` | stamp 합성 · bump 가 epoch touch |
| `src/bot/commands/food.ts` · `food-photo.ts` · `food-edit-callback.ts` | 재계산 블록 6곳을 `withHistoryCacheBump` 로 |
| `docs/roadmap.md` · `docs/specs/394-*.md` | 표기 |

## 6. 테스트 계획

§3 F5 + 4종 검증. 배포 후: 텔레그램 식단 기록 → 5초 뒤 `/history/<year>/<month>` 섭취 칼로리 갱신 (TTL 을 기다리지 않음) · `psql`: `select "lastAlertAt" from "SystemAlertState" where "alertType"='history_cache_epoch'`.

## 7. 제외 사항

- 별도 테이블 · 스키마 변경 (`prisma-drift-fix`) — key-value 행으로 충분.
- 캐시 엔트리의 즉시 제거 — 키가 바뀌면 옛 엔트리는 TTL · 용량으로 빠진다 (기존 설계).
