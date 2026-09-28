# [후속 #390] syncAll 의 weather backfill 실행 모드 — backfill 스크립트 종료 시 lock 해제 실패 방지

- **작성일**: 2026-09-28
- **타입**: fix (bug · P2)
- **이슈**: #390 (v2.29.0 배포 검증 2026-09-18)
- **브랜치**: `fix/390-1` (dev → dev)
- **의존**: #269 (weather backfill fire-and-forget) · #377 (`backfill:history`)

## 1. 배경 (2026-09-28 실코드 재검증 — 유효)

`syncAll` 은 끝에서 `runWeatherBackfill` 을 **fire-and-forget** (`void …then().catch()`) 으로 띄운다 (#269 Codex P1 — 리포트 파이프라인 지연 방지). `scripts/backfill-history.ts` 는 청크마다 `syncAll` 을 타입 단위로 부르고, 마지막에 `main().finally(() => prisma.$disconnect())` 한다. 백그라운드 weather backfill 이 `releaseBackfillLock` 을 시도할 때 엔진이 이미 닫혀 `Response from the Engine was empty` 로 lock 해제가 실패한다. lock 은 TTL 10분 self-heal 이라 데이터 손실은 없지만 그 안의 cron · 리포트 전 싱크의 weather backfill 이 "다른 실행자가 lock 보유 중" 으로 건너뛴다. 대상 타입이 `activities` 가 아니면 할 일도 없는데 청크마다 뜬다.

## 2. 목표

1. `syncAll` 호출자가 weather backfill 실행 방식을 고른다: `background` (기본 · 현행) · `await` · `skip`.
2. `backfill:history` 는 청크에서 `skip` — 종료 시 lock 해제 실패가 사라진다. 기상 보강은 스크립트 끝의 안내대로 `backfill:weather` 로 (활동 타입을 돌린 경우).
3. cron · 리포트 · 봇 · `/api/sync` 는 옵션을 안 넘기므로 동작 불변.

## 3. 요구사항

- [x] F1 `src/lib/garmin/weather-backfill-mode.ts` (순수): `WeatherBackfillMode` · `resolveWeatherBackfillMode(mode?)` (기본 background) · `weatherBackfillPlan(mode)` → `{ run, awaitResult }`.
- [x] F2 `syncAll` 옵션 `weatherBackfill?: WeatherBackfillMode` — plan 에 따라 skip / background / await.
- [x] F3 `scripts/backfill-history.ts`: 청크 `syncAll` 에 `weatherBackfill: "skip"`. 실행 종료 요약에 활동 타입이 포함됐으면 `npm run backfill:weather` 안내 한 줄.
- [x] F4 회귀: `weather-backfill-mode.test.ts` (기본 · 세 모드) + `verify-mcp-long-history` 소스 스캔 (스크립트가 `skip` 을 쓴다 · `syncAll` 이 옵션을 받는다).

## 4. 기술 설계

- 옵션 방식: 이슈 제안 그대로. 대안 (weather promise 를 반환값에 실어 스크립트가 기다림) 은 반환 타입을 바꾸고 모든 호출자에 영향 — 채택 안 함.
- `await` 모드는 지금 호출자가 없지만 스크립트류가 "마지막에 한 번 기다리기" 를 원할 때를 위해 둔다 (`sync-garmin.ts` 는 `$disconnect` 를 안 하므로 현행 background 로 충분).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/garmin/weather-backfill-mode.ts` (+ `__tests__/weather-backfill-mode.test.ts`) | 신규 · 순수 |
| `src/lib/garmin/sync.ts` | 옵션 · 끝의 fire-and-forget 을 plan 으로 |
| `scripts/backfill-history.ts` | `skip` · 종료 안내 |
| `scripts/verify-mcp-long-history.ts` | 소스 스캔 2건 |

## 6. 테스트 계획

§3 F4 + 4종 검증. 실증은 다음 `backfill:history` 실행 종료 로그에 `lock 해제 실패` 가 없는 것.

## 7. 제외 사항

- 스크립트 종료 전 백그라운드 작업 전체를 기다리는 일반 메커니즘 — 지금은 weather 하나뿐.
