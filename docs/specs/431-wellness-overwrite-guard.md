# [M16 #3] 심박 · 수면 재싱크 덮어쓰기 가드 — Garmin 보존 창 밖 응답이 기존 시계열 · HRV 를 지우지 않게 (+ #429 패널 E 후속)

- **작성일**: 2026-09-23
- **타입**: fix
- **이슈**: #431 (P1) · #429 (P2, 같은 PR)
- **브랜치**: `fix/431-1`
- **의존**: 없음 (스키마 변경 없음 · 패키지 추가 없음)

## 1. 배경

v2.36.0 `backfill:hrr` 에서 발견 (2026-09-23): 프로덕션 `HeartRateRecord.rawData.heartRateValues` 가 2026-04-19 이전 **2,132일 전부 `null`**, 배열은 04-20 이후 156일. `SleepRecord.hrvOvernight` 도 같은 경계. null 행 중 385건은 최초 싱크 (04-07) 때 만들어졌고, 로컬 dev DB 의 같은 날짜 (03-30~04-05, 04-07 싱크) 에는 시계열 684~720 샘플 · HRV 35~72 가 있다.

원인 세 겹:
1. **Garmin 이 일별 wellness 상세 (하루치 심박 시계열 · 야간 HRV) 를 최근 약 150일만 준다** — 그 밖은 `restingHeartRate` 같은 요약만 있고 `heartRateValues: null` · `avgOvernightHrv` 없음 (memory `project_garmin_wellness_retention`).
2. `syncHeartRate` · `syncSleep` 의 upsert 가 `update: data` 로 **rawData · avgHR · hrvStatus · hrvOvernight · restingHR 등을 무조건 덮어쓴다** (`fetchers/heart-rate.ts:52` · `sleep.ts:93`).
3. #377 `backfill:history` (09-17) 가 `heart_rate` · `sleep` 을 2020-06-01~ 전 기간 재조회 → 보존 창 밖은 null 응답 → 기존 값 소실.

손실 (2025-11 ~ 2026-04-19) 은 Garmin 이 더는 주지 않아 **복구 불가**. 이 이슈는 재발 방지다 — 5개월 뒤에도 지금 DB 의 값이 살아남아야 한다.

## 2. 목표

1. 재싱크 (cron · 리포트 보정 · 백필) 가 **들어온 값이 null 인 필드로 기존 값을 지우지 않는다.** 상세가 빠진 응답이면 rawData 도 기존 것을 유지.
2. `backfill:history` 가 보존 창 밖 wellness 재조회를 기본으로 막는다 (명시 플래그로만).
3. 규칙은 순수 함수 + vitest — "기존 배열 + 응답 null → 유지 · 기존 null + 응답 배열 → 갱신 · 둘 다 배열 → 갱신".

## 3. 요구사항

> **릴리즈 v2.36.1 (2026-09-23, PR #433 · #436 → 릴리즈 PR #434).** 사전 리뷰 2회 (major 1 · info 7 반영) · Codex: PR #433 미실행 · PR #436 P2 2 (반영 1 · #437) · 릴리즈 PR P2 2 (#435 반영 · #437). 후속 #437.
>
> **구현 (fix/431-1, 2026-09-23).** `preserve.ts` vitest 9건 (230 → 239). 실 API 없이 단위 테스트로 검증. 달라진 항목은 ↳.

**가드 (`src/lib/garmin/preserve.ts`, 순수)**
- [x] F1 `withoutNulls(data)` — update payload 에서 값이 `null` / `undefined` 인 키를 뺀다 (Prisma 에서 `undefined` = 무변경). create 는 그대로 (null 명시)
- [x] F2 `hasHeartRateDetail(raw)` = `heartRateValues` 가 비지 않은 배열 · `hasSleepDetail(raw)` = `avgOvernightHrv` 가 유한수 **또는** `sleepLevels` 가 비지 않은 배열
  - ↳↳ **#435 (릴리즈 PR #434 Codex P2)**: 특정 필드 판정을 버리고 `isTrimmedResponse(incoming, existing)` — 기존 rawData 의 "값 있음" 최상위 키 (비지 않은 배열 · 0 아닌 유한수 · 비지 않은 객체) 가 응답에서 사라졌으면 trimmed → rawData 유지. HRV 없는 밤의 SpO2 epochs · `sleepHeartRate` 도 보존. fetcher 는 응답과 무관하게 기존 행을 하루 1회 읽는다. `hasHeartRateDetail` · `hasSleepDetail` 은 제거 (dead code · 좁은 판정 재유입 방지 — 사전 리뷰 info 2)
  - ↳ **`avgOvernightHrv` 만** (사전 리뷰 major 1): `sleepLevels` 는 보존 창 밖에서도 올 수 있어 (Garmin Connect 는 수년 전 수면 단계도 보여 준다) OR 이면 HRV 없는 재조회가 rawData 를 덮어써 `avgOvernightHrv` · `hrvData` · `sleepHeartRate` 를 잃는다. 소실이 실측된 필드만 기준
- [x] F3 `preserveUpdate(data, { incomingDetail, existingDetail })` — `withoutNulls` 적용 후, `!incomingDetail && existingDetail` 이면 `rawData` 도 뺀다 (기존 rawData 유지). 파생 컬럼 (`avgHR` · `hrvOvernight`) 은 null 이라 F1 이 이미 뺀다
  - ↳ #435: 시그니처 `preserveUpdate(data, { trimmed })` · `trimmed = isTrimmedResponse(raw, existing?.rawData)`
- [x] F4 회귀 테스트 3 케이스 + null 필드 생략 + `existingDetail` 만 있을 때 rawData 제외 (`src/lib/garmin/__tests__/preserve.test.ts`)
  - ↳ #435: `isTrimmedResponse` 케이스 (배열 소실 · 새 키 · 값 변경 · 첫 저장 · 비객체 응답 · 0/문자열/불리언 규칙 · 수치 → 0) + `preserveUpdate({ trimmed })`

**fetcher**
- [x] F5 `syncHeartRate`: 응답에 상세가 없으면 기존 행 `select { rawData }` 1회 → `preserveUpdate`. 상세가 있으면 조회 없이 `withoutNulls(data)` 로 update. create 는 기존과 동일. `isEmptyHeartRate` (#383 빈 날 skip) 는 그대로 — 요약도 없는 날은 여전히 저장하지 않는다
- [x] F6 `syncSleep`: 동일. `sleepScoreDetails` 는 객체 | null 로 들고 create 에서만 `Prisma.DbNull` 로 (update 에서 null 이면 생략)
  - ↳ Prisma update 타입이 `null` 을 받지 않아 `sleepScoreDetails` 는 data 밖에서 조건부 spread
- [x] F7 `backfill:history`: `--types` 에 `heart_rate` · `sleep` 이 있고 `--from` 이 `today − 150일` 보다 앞이면 **기본 중단** + 안내 (보존 창 · 가드 · `--allow-old-wellness` 로 강제). 상수 `WELLNESS_RETENTION_DAYS = 150` 은 `preserve.ts` 에

**#429 (같은 PR)**
- [x] F8 `scripts/backfill-hrr.ts` 이어가기 명령에 `--dry-run` 유지
- [x] F9 패널 E 연도 중앙값 점에 `toggleId: String(year)` — 연도 토글을 끄면 그 해 중앙값도 숨김
- [x] F10 패널 E `how` 캡션에 시작일을 데이터에서 — `종료 후 심박은 2026-04 부터 있습니다` (존 패널 `zoneFrom` 규칙 · `hrrPoints[0].ymd`)

**문서**
- [x] F11 `docs/specs/garmin-endpoint-audit-20260917.md` 에 보존 창 관찰 추가 · 이 스펙에 프로덕션 확인 쿼리 (`jsonb_typeof`)

## 4. 기술 설계

```
fetchers/heart-rate.ts  (↳ #435 반영)
  raw → data (기존)
  existing = await prisma.heartRateRecord.findUnique({ where: { date }, select: { rawData } })   ← 항상 1회
  update = preserveUpdate(data, { trimmed: isTrimmedResponse(raw, existing?.rawData) })
  upsert({ update, create: { date, ...data } })
fetchers/sleep.ts — 동일 (sleepData vs existing.rawData)
scripts/backfill-history.ts — 시작 시 wellness 타입 × from 검사
```

**왜 "null 이면 생략" 이 안전한가**: wellness 값은 시간이 지나 **없어지는** 방향으로만 변한다 (Garmin 보존 창). 있던 값이 정당하게 null 로 바뀌는 경우는 없다. 요약 필드 (`restingHR` · `maxHR`) 가 같은 날 재싱크에서 달라지는 경우 (기기 재동기화) 는 non-null 이므로 그대로 갱신된다.

**프로덕션 확인 쿼리** (배포 후 · 다음 백필 전후):
```bash
psql "$DATABASE_URL" -Atc "select coalesce(jsonb_typeof(\"rawData\"->'heartRateValues'),'(no key)') t, min(date)::date, max(date)::date, count(*) from \"HeartRateRecord\" group by 1 order by 2;"
psql "$DATABASE_URL" -Atc "select count(*) filter (where \"hrvOvernight\" is not null), min(date) filter (where \"hrvOvernight\" is not null)::date from \"SleepRecord\";"
```

**배포 후 확인 (2026-09-23 · v2.36.1 · 14:11 KST 재기동 → 15:00 cron 21건 · 실패 0 이후)**: `heartRateValues` array **156일 (2026-04-20 ~ 09-22)** · null 2,132일 (2020-06-18 ~ 2026-04-19) · `hrvOvernight` **156일 (2026-04-20 ~)** — 릴리즈 전 기준 (156 · 156 · 04-20) 과 동일. 손실 없음. 일일 cron 은 3일 창이라 보존 창 안쪽만 재조회하므로 이 확인은 "가드가 정상 데이터를 깎지 않는다" 의 확인이고, 가드가 실제로 개입하는 상황은 다음 `backfill:history` — 그때 같은 두 쿼리를 전후로 다시 돈다.

**보존 창 감사 (2026-09-23 · 체크리스트 "다른 일별 타입 감사")**: `DailySummary.rawData` 를 월별 `jsonb_typeof(... ) = 'number'` 로 셈 (2020-06 ~ 2026-09, 76개월) — `bodyBatteryMostRecentValue` · `averageStressLevel` 은 **전 기간 행 수와 일치** (창 없음). `highStressDuration` 만 2023-10 ~ 2025-04 사이 월 1~2일 결측 (워치 미착용 · 스트레스 미측정 성격, 기간 경계 아님). `fitness_metrics` 는 fetcher 가 소스 키 단위로 rawData 를 병합해 (사전 리뷰 M1) 빈 응답이 기존 원본을 지우지 못하므로 덮어쓰기 위험 없음 — 창 자체는 미측정. **daily_stats fetcher 에 가드를 추가할 이유 없음. 이슈 미생성.**

```bash
psql "$DATABASE_URL" -Atc "select to_char(date,'YYYY-MM') m, count(*) n, count(*) filter (where jsonb_typeof(\"rawData\"->'bodyBatteryMostRecentValue')='number') bb, count(*) filter (where jsonb_typeof(\"rawData\"->'averageStressLevel')='number') stress, count(*) filter (where jsonb_typeof(\"rawData\"->'highStressDuration')='number') stress_dur from \"DailySummary\" group by 1 order by 1;"
```

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/garmin/preserve.ts` (+ `__tests__/preserve.test.ts`) | 신규 · 순수 |
| `src/lib/garmin/fetchers/heart-rate.ts` · `sleep.ts` | update 가드 |
| `scripts/backfill-history.ts` | 보존 창 검사 |
| `scripts/backfill-hrr.ts` · `src/app/insights/page.tsx` | #429 |
| `docs/specs/431-wellness-overwrite-guard.md` · `garmin-endpoint-audit-20260917.md` | 스펙 · 감사 |

## 6. 테스트 계획

- `preserve.test.ts`: (1) 기존 배열 + 응답 null → update 에 rawData · avgHR 없음 (2) 기존 null + 응답 배열 → rawData · avgHR 포함 (3) 둘 다 배열 → 포함 (4) `withoutNulls` 가 0 · false · "" 는 남긴다 (5) `isTrimmedResponse` 의 값 있음 규칙 (↳ #435)
- 4종 검증 · 로컬 실증: 로컬 dev DB 의 04-05 행 (시계열 있음) 에 시계열 없는 응답을 흉내 낸 단위 테스트로 대체 (실 API 호출 없음)

## 7. 제외 사항

- **알려진 한계 (사전 리뷰 info 3)**: 값이 정당하게 present → absent 로 바뀌는 드문 경우 (Garmin Connect 에서 수면 구간을 편집해 어떤 단계가 0초가 되면 `x ? … : null` 이 null) 는 update 에서 생략돼 옛 값이 남는다. wellness 값의 변화 방향이 거의 항상 "없어짐 = 보존 창" 이라 수용. `hrvBaseline` 은 항상 null 을 보내므로 update 에서 영구 무변경 — 지금 계산하는 코드가 없어 영향 없음 (info 4).

- 2026-04 이전 시계열 · HRV 복구 — 불가.
- `daily_stats` (스트레스 · 바디배터리 상세) 의 보존 창 — 릴리즈 시점엔 미확인으로 남겼고, 배포 후 감사 (§4) 로 **창 없음** 확인. `fitness_metrics` 의 보존 창은 **여전히 미측정** — fetcher 의 소스 키 병합은 잘린 응답이 기존 원본을 덮어쓰지 못한다는 것만 보장하고, 엔드포인트가 옛 날짜를 주는지는 별개 (다음 백필 전 감사).
- `body_composition` · `blood_pressure` 는 수동/기기 기록이라 보존 창 무관 (가정).
