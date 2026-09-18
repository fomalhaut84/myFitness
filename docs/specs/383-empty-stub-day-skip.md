# 워치 미착용 기간의 빈 DailySummary/HeartRateRecord stub 저장 방지 + 기존 stub 정리

- **작성일**: 2026-09-18
- **타입**: fix
- **이슈**: #383 (감사 A11 · v2.28.0 backfill 관찰)
- **관련**: #377 backfill, `docs/specs/garmin-endpoint-audit-20260917.md` A11

## 1. 배경

v2.28.0 backfill(2026-09-17) 후 활동·수면·체중이 전혀 없는 2019-06 ~ 2020-06(워치 사용 전) 구간에
`DailySummary` 367행 · `HeartRateRecord` 326행+ 가 저장됐다. 전부 빈 stub 이다 (`count(steps)=0`, `count(restingHR)=0`).

원인: `daily-summary.ts` 는 `summary.calendarDate` 만 검사하고 저장했고 `heart-rate.ts` 는 `hrData` 존재만 검사했다.
Garmin 은 데이터가 없는 날에도 `calendarDate` 가 있는 응답을 돌려준다.

**실측 (2019-08-01, 2026-09-18 로컬 probe):** daily summary 86키 중 `userProfileId`/`displayName`/`calendarDate`/`source`
만 non-null, `privacyProtected:false`, `includesWellnessData:false`, `includesActivityData:false`. heart rate 는
`restingHeartRate`/`maxHeartRate`/`minHeartRate` null, `heartRateValues` **null** (빈 배열이 아님).

영향: `get_data_coverage` 의 `daily_stats.oldest` 가 2019-06-01 로 나와 "기록 시작"이 실제(2020-06)보다 1년 앞섰고,
버킷 `count` 가 부풀며, 매일 cron 도 워치를 안 찬 날엔 stub 를 만들었다.

## 2. 요구사항

- [x] **F1** `syncDailySummaries`: 핵심 지표(`totalSteps` · `restingHeartRate` · `totalKilocalories` · `bodyBatteryHighestValue`)가
  전부 null/0 이면 저장하지 않고 skip (rawData 에도 남기지 않음). `privacyProtected === true` 는 인증 이상으로 분류해 **throw** (A11) —
  미래 날짜 가드보다 앞에 둔다 (인증 이상은 stub 여부와 무관하게 실패여야 한다).
- [x] **F2** `syncHeartRate`: `restingHeartRate` 와 `heartRateValues` 가 모두 없으면 skip (HRV 용 `getSleepData` 호출도 생략).
- [x] **F3** `scripts/cleanup-stub-days.ts`: dry-run 기본, `--apply` 로 실행, 삭제 건수·날짜 범위 출력. 두 테이블 삭제는 한 트랜잭션.
- [x] **F4** `scripts/verify-empty-day-skip.ts` (npm test 체인): 실측 stub fixture 로 판정, where 빌더, 소스 스캔.

판정·where 는 `src/lib/garmin/empty-day.ts` (순수 모듈) 한 곳에 둔다 — fetcher skip 조건과 정리 스크립트 삭제 조건이 같은 정의를 쓴다.

## 3. 설계 결정

### 3.1 핵심 4지표 기준 (부분 착용일은 저장)

걸음만 있는 날(심박 없이 착용), BMR 만 찍힌 날(총칼로리) 은 **저장**한다. 스트레스처럼 핵심 밖 필드만 있는 응답은 관찰된 적 없어
핵심 4개로 판정한다. `0` 은 null 과 같이 본다 (Garmin 이 0 으로 채우는 변형 대비).

### 3.2 정리 스크립트는 식단 기록일을 보호

`DailySummary` 는 M4-2 칼로리 밸런스(`estimatedIntakeCalories`/`calorieBalance`) 의 저장소이기도 하다. 워치는 안 찼지만
식단을 기록한 날은 stub 처럼 보여도 삭제하지 않는다 (`estimatedIntakeCalories IS NULL` 조건). 2019-06~2020-06 구간엔 식단 기록이
없으므로 실제 삭제 대상은 동일하다.

### 3.3 알려진 트레이드오프 — 미착용일 + 식단 기록

F1 이후 워치를 안 찬 날엔 `DailySummary` 행이 생기지 않는다. 그날 식단을 기록하면 `recalculateCalorieBalance` 가
`if (!summary) return` 으로 skip 하므로 `get_weight_loss_status.dailyBalances` 에 그날 `intake` 가 실리지 않는다
(이전엔 stub 행에 intake 만 실리고 balance 는 null 이었다). `macroSummary.daily` 는 FoodLog 기준이라 그대로 나온다.
밸런스 자체는 `activeCalories` 가 없어 어차피 null 이었으므로 실질 손실은 `dailyBalances[].intake` 한 칸이다.
**수용** — 착용하지 않은 날의 밸런스 행을 위해 Garmin stub 을 유지하는 것보다 coverage 정확성이 우선. 필요해지면
식단 기록 시 DailySummary 행을 만드는 쪽(FoodLog 경로)에서 처리한다 (후속).

## 4. 배포 후 절차 (프로덕션 1회)

```bash
npx tsx scripts/cleanup-stub-days.ts            # dry-run: 대상 건수·날짜 범위 확인 (기대: 2019-06-01 ~ 2020-06-xx, 식단 기록 없음)
npx tsx scripts/cleanup-stub-days.ts --apply    # 삭제 → "정리 후 최초 기록" 이 2020-06 으로 나오는지 확인
```

이후 `get_data_coverage` 의 `daily_stats.oldest` / `heart_rate.oldest` 가 2020-06 으로 바뀐다. `SyncMetadata.oldestFetchedDate`
는 그대로 2019-06-01 (가져왔지만 기록이 없는 구간 — coverage 문구가 이미 그 구분을 설명한다).

## 5. 제외

- SleepRecord (이미 `sleepStartTimestampGMT` 없으면 skip).
- backfill 스크립트 변경 없음.
- A11 의 상위 항목인 토큰 권한/복원력(D-2) 은 별도 이슈.
