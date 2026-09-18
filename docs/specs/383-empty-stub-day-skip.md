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
  `calendarDate` 가드·미래 날짜 가드보다 앞에 둔다 (마스킹된 응답은 `calendarDate` 도 없을 수 있어 뒤에 두면 조용히 skip — 사전 리뷰 major 1).
  메시지에 `unauthorized` 를 넣어 `isGarminAuthError` 패턴에 걸리게 한다 (기존 관리자 알림 경로 재사용).
- [x] **F2** `syncHeartRate`: `restingHeartRate` 와 `heartRateValues` 가 모두 없으면 skip (HRV 용 `getSleepData` 호출도 생략).
- [x] **F3** `scripts/cleanup-stub-days.ts`: dry-run 기본, `--apply` 로 실행, `--from/--to` 범위, 삭제 건수·날짜 범위 출력. 두 테이블 삭제는 한 트랜잭션.
  삭제 조건은 skip 조건보다 **엄격** (§3.2).
- [x] **F5 (사전 리뷰 major 3)** `get_weight_loss_status` 연속 결손 일수를 행 배열이 아니라 **달력 날짜 기준**으로 (§3.3).
- [x] **F4** `scripts/verify-empty-day-skip.ts` (npm test 체인): 실측 stub fixture 로 판정, where 빌더, 소스 스캔.

판정·where 는 `src/lib/garmin/empty-day.ts` (순수 모듈) 한 곳에 둔다 — fetcher skip 조건과 정리 스크립트 삭제 조건이 같은 정의를 쓴다.

## 3. 설계 결정

### 3.1 핵심 4지표 기준 (부분 착용일은 저장)

걸음만 있는 날(심박 없이 착용), BMR 만 찍힌 날(총칼로리) 은 **저장**한다. 스트레스처럼 핵심 밖 필드만 있는 응답은 관찰된 적 없어
핵심 4개로 판정한다. `0` 은 null 과 같이 본다 (Garmin 이 0 으로 채우는 변형 대비).

### 3.2 삭제 조건은 skip 조건보다 엄격하다

skip 은 다음 싱크에 복구되지만 `deleteMany` 는 되돌릴 수 없다. 그래서 정리 스크립트는 핵심 4개뿐 아니라 **나머지 지표 컬럼과
칼로리 밸런스 컬럼(`estimatedIntakeCalories` · `availableCalories` · `calorieBalance`)까지 전부 null 인 행만** 지운다
(`emptyDailySummaryWhere`, 사전 리뷰 major 2). 워치는 안 찼지만 식단을 기록한 날은 밸런스 이력이라 자동으로 보호된다.
HeartRateRecord 는 `hrvBaseline` 까지 포함해 저장 컬럼 전부 null.

dry-run 은 "핵심 4개는 비었지만 다른 지표가 있는 행"(= 삭제 대상에서 빠진 행)을 따로 세어 경고한다. `--from/--to` 로 범위를
못박는 것을 권장 — 2019-06~2020-06 stub 은 전 컬럼 null 이라 엄격 조건으로도 그대로 잡힌다.

### 3.3 알려진 트레이드오프 — 미착용일 + 식단 기록

F1 이후 워치를 안 찬 날엔 `DailySummary` 행이 생기지 않는다. 그날 식단을 기록하면 `recalculateCalorieBalance` 가
`if (!summary) return` 으로 skip 하므로 `get_weight_loss_status.dailyBalances` 에 그날 `intake` 가 실리지 않는다
(이전엔 stub 행에 intake 만 실리고 balance 는 null 이었다). `macroSummary.daily` 는 FoodLog 기준이라 그대로 나온다.
밸런스 자체는 `activeCalories` 가 없어 어차피 null 이었으므로 실질 손실은 `dailyBalances[].intake` 한 칸이다.
**수용** — 착용하지 않은 날의 밸런스 행을 위해 Garmin stub 을 유지하는 것보다 coverage 정확성이 우선. 필요해지면
식단 기록 시 DailySummary 행을 만드는 쪽(FoodLog 경로)에서 처리한다 (후속).

**같은 전제를 깨는 지점 하나를 이번에 고쳤다 (사전 리뷰 major 3).** `get_weight_loss_status` 의 연속 결손/750kcal 초과 연속일은
조회된 **행 배열**을 역순으로 돌며 `calorieBalance === null` 을 "끊김" 으로 썼다 — stub 행이 있어야 성립하는 불변식이라, 미착용일에
행이 없어지면 구멍을 건너뛰어 streak 이 과대 계산된다 (감량 리스크 경고에 직접 노출). `countConsecutiveBelow` 로 오늘부터 **달력
날짜**를 역순 순회해 행이 없는 날도 끊기게 했다. 회귀: verify [6].

## 4. 배포 후 절차 (프로덕션 1회)

```bash
npx tsx scripts/cleanup-stub-days.ts --from=2019-06-01 --to=2020-06-30            # dry-run: 대상 건수·날짜 범위 · "핵심만 빈 행" 경고 0건 확인
npx tsx scripts/cleanup-stub-days.ts --from=2019-06-01 --to=2020-06-30 --apply    # 삭제 → "정리 후 최초 기록" 이 2020-06 으로 나오는지 확인
```

이후 `get_data_coverage` 의 `daily_stats.oldest` / `heart_rate.oldest` 가 2020-06 으로 바뀐다. `SyncMetadata.oldestFetchedDate`
는 그대로 2019-06-01 (가져왔지만 기록이 없는 구간 — coverage 문구가 이미 그 구분을 설명한다).

## 5. 제외

- SleepRecord (이미 `sleepStartTimestampGMT` 없으면 skip).
- backfill 스크립트 변경 없음.
- A11 의 상위 항목인 토큰 권한/복원력(D-2) 은 별도 이슈.

## 6. 사전 리뷰 반영 (pr-review-toolkit 1회 · critical 0 / major 3 / info 3)

- **major 1** privacy 검사가 `calendarDate` 가드 뒤라 마스킹 응답에서 도달 불가 → 가드 앞으로 + verify 순서 어서션.
- **major 2** 삭제 조건이 skip 조건과 같아 다른 지표가 있는 행도 지울 수 있었고 범위 인자가 없었음 → 전 지표 컬럼 null 조건 · `--from/--to` · dry-run 경고.
- **major 3** `get_weight_loss_status` streak 이 stub 행에 의존 → 달력 날짜 기준 `countConsecutiveBelow` + 회귀 테스트.
- **info 1** privacy 메시지에 `unauthorized` 포함 (인증 실패 알림 경로 재사용). **info 2** `isNullOrZero` 의 비수치 문자열 처리 의도 주석. **info 3** skip 건수 로그를 `finally` 로.
