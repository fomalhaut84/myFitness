# 마일스톤 15 — 히스토리 브라우저 + 기간별 추이 분석

- **시작**: 2026-09-18
- **테마**: 2020-06 부터 쌓인 6년치 Garmin 데이터를 **연 → 월 → 일** 로 탐색하고, 지표별로 **주/월/연 단위 추이**를 비교하는 UI. 지금까지의 UI 는 "최근 N일" 고정창이라 장기 데이터를 사람이 직접 볼 수 없다.
- **선행 의존**: v2.28.0 (MCP 장기 조회 · 과거 backfill, #377) · v2.29.0 (VO2max·LT 이력 #378, 빈 stub 정리 #383). 데이터는 이미 다 있다. 이 마일스톤은 **읽기 전용 UI + 집계 API** 이며 Garmin 호출·스키마 변경이 없다 (M15-4 의 컬럼 승격 1건 제외).
- **하위 이슈**: M15-0 (#392, 추적) · M15-1 (#393) · M15-2 (#394) · M15-3 (#395) · M15-4 (#396) · M15-5 (#397)

## 배경

### 실데이터 규모 (프로덕션, 2026-09-18 기준)

| 모델 | 행 | 기간 | 비고 |
|---|---|---|---|
| Activity | 2,332 | 2020-06-19 ~ | 러닝 중심. zoneDistribution · 러닝 다이나믹스 · 기상 필드 포함 |
| DailySummary / HeartRateRecord | 일별 | 2020-06-19 ~ | #383 으로 그 이전 빈 stub 제거됨 |
| SleepRecord | 일별 | 2020-06 ~ | 단계 · 점수 · HRV · SpO2 |
| BodyComposition | 372 | 2020-06-16 ~ | 체중 · 체지방 |
| FitnessMetricDaily | 2,000 | 2020-06-26 ~ | VO2max · LTHR · LT 페이스 |
| BloodPressure | 소수 | 최근 | |
| FoodLog | | 2026 ~ | M14 |
| AIAdvice | | 2026 ~ | `reportDate` 로 날짜 조인 가능 |

### 현재 UI 의 한계 (2026-09-18 인벤토리)

| 페이지 | 데이터 창 | 과거 이동 |
|---|---|---|
| `/` | 7일 · 30일 고정 (`src/app/page.tsx:26-29`) | 없음 |
| `/activities` | 최근 20건 · 8주 (`activities/page.tsx:31`) | 없음. 타입 필터만 |
| `/sleep` `/heart` `/body` | 30 · 90 · 60일 고정 | 없음. `/sleep/[date]` 는 URL 직접 입력만 |
| `/lifestyle` | 이번 주 · 이번 달 히트맵 | `?date=` 는 식단 섹션만 |
| `/nutrition` | 선택일 | `NutritionDateNav` (일 단위만) |
| `/reports` | 커서 페이지네이션 | 뒤로만 |

구조적 갭:

1. **월·연 집계 헬퍼가 없다.** 주간 롤업은 `weight-trend.ts:78 summarizeWeek` 와 두 페이지의 인라인 8주 루프뿐. MCP `getCalendarSummary` 는 일 단위 · 90일 상한.
2. **API 가 기간을 못 받는다.** `/api/dashboard` 는 파라미터 없음, `/api/export` 는 테이블 전체 덤프, `/api/activities` 는 `limit/offset` 만 (`from/to` 없음).
3. **날짜 경계가 서버 로컬 TZ.** 차트 x 키 대부분이 `formatDateLocal` (`src/lib/format.ts:2`), 월 시작은 페이지마다 인라인 (`lifestyle/page.tsx:44`, `activities/page.tsx:21`), `kstDayRange` 가 두 페이지에 중복. **#365 와 같은 뿌리** — M15-1 에서 KST 연·월·주 헬퍼를 한 곳에 만들며 흡수한다.

재사용 자산: `TrendLineChart` (`src/components/ui/TrendLineChart.tsx`, 일 라벨만 하드코딩 · 지표 generic), `MonthlyHeatmap` (`year/month` 를 받음 · 이진값만), `parseHistoryYmd` + `MIN_HISTORY_YMD` (`src/lib/date.ts:14,20`), `startOfWeekKST`/`weekStartKST` (`date.ts:44,78`), `todayKST`/`ymdKST` (`src/lib/garmin/utils.ts`), MCP `get_data_coverage`.

## 설계 결정

### D1. 라우트: `/history` 단일 트리, 드릴다운

```
/history                       → 최신 연도로 redirect
/history/2024                  → 연 뷰
/history/2024/03               → 월 뷰
/history/2024/03/15            → 일 뷰 (일간 종합)
/trends                        → 추이 분석 (지표 × 단위)
```

- 각 레벨에 **이전/다음 + 점프 picker** (연: 연도 탭, 월: `<input type="month">`, 일: `<input type="date">`). `NutritionDateNav` 의 패턴을 레벨 파라미터화해 공용화.
- 상위 셀 클릭 → 하위 레벨. 브레드크럼 `2024 › 3월 › 15일`.
- 사이드바에 **"기록"** (`/history`) · **"추이"** (`/trends`) 2개 메뉴 추가. 기존 페이지는 손대지 않는다 (기존 페이지에 기간 선택기를 넣는 방안은 페이지마다 창이 달라 일관성이 안 나오므로 제외).
- 유효 범위: `MIN_HISTORY_YMD`(2020-01-01) ~ 오늘 KST. 시작 연도는 `SyncMetadata.oldestFetchedDate` 의 최소값. 미래·범위 밖은 `parseHistoryYmd` 와 같은 규칙으로 최신으로 fallback.

### D2. 일 뷰 = 일간 종합 페이지 (신설)

두 안을 비교했다.

| 안 | 장점 | 단점 |
|---|---|---|
| **A. 종합 페이지 (채택)** | 하루의 모든 데이터가 한 화면. "그날 무슨 일이 있었나" 질문에 1클릭 | 페이지 1개 신설 · 섹션 8개 |
| B. 링크 허브 | 구현 최소 | 활동·수면·심박·체성분·영양 5 페이지를 오가야 하고 그 페이지들은 과거 날짜를 못 받는다. 허브가 사실상 빈 페이지가 됨 |

B 는 기존 페이지가 고정창이라 성립하지 않는다. A 로 가되 **"요약 카드 + 심층은 기존 상세로 위임"** 으로 무게를 줄인다:

- 섹션: ① 그날 활동 목록 (카드 → `/activities/[id]`) ② 수면 요약 (점수·단계·HRV·최저 SpO2 → `/sleep/[date]`) ③ 심박·스트레스·바디배터리 ④ 체중·체지방 (그날 측정 있으면) ⑤ 혈압 (있으면) ⑥ 걸음·칼로리 밸런스 ⑦ 식단 (FoodLog, → `/nutrition?date=`) ⑧ 그날의 AI 리포트 (AIAdvice `reportDate` 매칭, 모닝/이브닝)
- 데이터 없는 섹션은 **"기록 없음"** 으로 접어서 표시 (숨기지 않는다 — 워치 미착용일을 구분해야 한다).
- 상단에 전날/다음날 이동 + 월 뷰로 올라가기.

### D3. 초기 지표 세트 (연·월 뷰 셀 값)

사용자 확정 (2026-09-18): **러닝 km · 걸음 · 수면 점수 · 안정시 심박 · 체중** 5개. 지표 선택기는 URL `?metric=` 로 유지해 링크 공유가 되게 한다.

추가 후보 (착수 중 판단, 코드 구조는 지표 추가가 등록 1건이 되도록): 러닝 횟수, 활성 칼로리, 평균 스트레스, 바디배터리 최고, HRV, VO2max, 칼로리 밸런스.

### D4. 지표별 집계 정책 (M15-1 의 핵심)

집계 규칙을 지표 레지스트리 하나에 명시한다. 페이지가 각자 reduce 하지 않는다.

| 지표 | 소스 | 일 → 주/월/연 | 결측 처리 | 차트 |
|---|---|---|---|---|
| 러닝 km | Activity (isRunningType) distance | **합계** | 0 (활동 없음은 진짜 0) | 막대 |
| 러닝 횟수 | Activity | 합계 | 0 | 막대 |
| 걸음 | DailySummary.steps | 합계 · 일평균 병기 | null 일은 제외, 커버 일수 표기 | 막대 |
| 활성 칼로리 | DailySummary.activeCalories | 합계 | 제외 | 막대 |
| 수면 점수 | SleepRecord.sleepScore | **평균** + min/max | 제외 | 선 + 밴드 |
| 안정시 심박 | DailySummary.restingHR | 평균 + min/max | 제외 | 선 + 밴드 |
| HRV | SleepRecord.hrvOvernight | 평균 | 제외 | 선 |
| 스트레스 | DailySummary.avgStress | 평균 | 제외 | 선 |
| 체중 | BodyComposition.weight | 평균 · 기간 말 값 병기 | 제외 (측정일만) | 선 |
| VO2max | FitnessMetricDaily.vo2maxRunning | **기간 최고 · 기간 말** | 제외 | 선 |
| LT 페이스 | FitnessMetricDaily.lthrPace | 기간 말 (최신) | 제외 | 선 |

- **결측은 0 이 아니다.** 평균류는 null 을 제외하고 `coveredDays/totalDays` 를 함께 반환한다. UI 는 커버리지가 낮은 버킷을 흐리게 표시.
- 버킷 경계는 전부 **KST**: 일 = `todayKST` 계열, 주 = `startOfWeekKST` (월요일), 월·연 = 신설 `startOfMonthKST`/`startOfYearKST`.
- 러닝 판정은 기존 `isRunningType` 을 그대로 쓴다 (러닝 중심 원칙).

### D5. 집계 API

`GET /api/history/summary?granularity=day|week|month|year&from=YYYY-MM-DD&to=YYYY-MM-DD&metrics=runningKm,steps,...`

- 응답: `{ granularity, buckets: [{ start, end, values: { runningKm: { value, coveredDays } , ... } }], coverage }`. 규칙대로 단위 포함.
- 구현: **raw query 금지** 규칙을 지킨다. `date_trunc` 대신 필요한 컬럼만 `select` (rawData 제외) 후 JS 집계. 6년치라도 일별 모델은 약 2,300 행, Activity 2,332 행이라 충분히 가볍다. 실측 후 느리면 `lastSyncAt` 키의 메모리 캐시를 붙인다 (캐시는 후속, 선제 최적화 금지).
- `from/to` 검증: `parseHistoryYmd` 규칙, 최대 범위 연 뷰 전체 (오늘까지). 잘못된 값은 400 `{ error }`.
- 같은 함수를 서버 컴포넌트가 직접 호출한다 (페이지는 fetch 왕복 없이 lib 호출, API 는 클라이언트 지표 전환용).
- 곁들이는 API 정비: `/api/activities` 에 `from/to` 추가 (페이지 기간 필터·페이지네이션 UI 연결), `/api/export` 에 `from/to` 추가.

### D6. 추이 분석 (`/trends`, M15-3)

- 컨트롤: 지표 (D3/D4 레지스트리) × 단위 (주/월/연) × 기간 (최근 1년 · 3년 · 전체).
- 뷰 3종:
  1. **시계열**: 합계 지표는 막대, 평균 지표는 선 + min/max 밴드. `TrendLineChart` 에 라벨 포맷 prop 을 추가해 재사용 (일 라벨 하드코딩 해제).
  2. **전년 동기 겹침 (YoY)**: x 축 1~12월, 연도별 선. 월별 러닝 km · 체중 · VO2max · 수면 점수에서 가장 정보량이 크다.
  3. **계절성**: 연도 무관 월별 평균 12개 막대.
- **기간 비교**: 두 구간 (예: 2023-11~2024-03 vs 최근 5개월) 을 골라 KPI 표를 나란히. 인계 문서의 실사용 질문 "컨디션 최고 시기" 를 UI 로 확인하는 용도.
- Recharts 규칙 준수 (memory `feedback_recharts_defaults`): 시간 축은 `scale="time"` 시 tick 이 Date, `allowDataOverflow` 기본값 주의.

### D7. 하이라이트 (M15-4)

- **개인 기록 패널**: 5K·10K·HM 최고 (기존 `running-buckets.ts` 버킷 재사용), 최장 거리, 최다 km 월, 최고 VO2max, 최저 RHR — 날짜와 링크.
- **이벤트 마커**: 추이 차트 위 세로선. 소스 3종 — `MetricChange` (maxHR·LTHR 변경), `TrainingPlan` 기간, **레이스** (Activity rawData `eventType.typeKey === "race"`). 레이스는 감사 D-4 의 **`eventType` 컬럼 승격** (rawData 백필, API 호출 0) 이 선행. 이 마일스톤의 유일한 스키마 변경.
- **차트 포인트 → 일 뷰 링크**: `/trends` 와 연·월 뷰의 모든 포인트/셀 클릭이 `/history/Y/M/D` 로 간다.
- **데이터 커버리지 띠**: `/history` 상단, `get_data_coverage` 재사용.

### D8. 심화 시각화 후보 (M15-5, 착수 시 선별)

| 영역 | 후보 | 필드 |
|---|---|---|
| 러닝 | 페이스 대비 심박 효율 산점도 (연도별 색) | avgPace, avgHR |
| 러닝 | 월별 HR 존 분포 스택 | zoneDistribution |
| 러닝 | 유산소·무산소 TE · intensityLabel 비율 월별 | aerobicTE, anaerobicTE, intensityLabel |
| 러닝 | 기온 vs 페이스 산점도 (습도 색) | weatherTempC, weatherHumidityPct |
| 러닝 | 케이던스·보폭·수직진폭 장기 추세 | avgCadence, avgStrideLength, avgVerticalOscillation |
| 러닝 | 요일·시간대 히스토그램, routeTag 별 반복 코스 비교 | startTime, routeTag |
| 수면 | 취침·기상 시각 산점도 (규칙성의 연 단위 변화) | sleepStart, sleepEnd |
| 수면 | 단계 비율 월별 스택 · HRV + 7일 기준선 · 최저 SpO2 월별 | deep/light/rem, hrvOvernight, lowestSpO2 |
| 일상 | 스트레스 고·중·저 시간 스택 · 바디배터리 충전/소모 | stress*Duration, bodyBattery* |
| 체중 | 전체 이력 + 목표선 · 월별 칼로리 밸런스 vs 체중 변화 | weight, targetWeight, calorieBalance |
| 교차 | 주간 km 와 다음 주 RHR 지연 상관 · 수면 점수와 다음날 페이스 | 조인 |

**SpO2 는 절대 임계 경고 금지** (memory `project_user_spo2_baseline`: 사용자 야간 최저 83~88 이 정상 범위). 개인 baseline 대비로만 표현.

## 공통 요구사항

- [ ] 모든 날짜 경계 KST. `formatDateLocal` 을 신규 코드에서 쓰지 않는다.
- [ ] 다크 테마 · 모바일: 월 그리드는 7열이 폰 폭 (360px) 에 들어가야 한다. 연 뷰는 모바일에서 12개 미니 히트맵 세로 스택.
- [ ] 수치 단위 표기 규칙 (km 소수 2자리 · bpm 정수 · kg 소수 1자리 · 페이스 min:sec/km).
- [ ] 결측 = "기록 없음". 0 과 구분.
- [ ] 회귀 테스트: 집계 정책 (합계/평균/최고/기간 말 · 결측 제외 · KST 월 경계 · 윤년 · 주 경계 월요일) 은 vitest `src/lib/history/__tests__/`.
- [ ] 4종 검증 통과. UI 이슈는 `frontend-design` 디자인 단계 필수 (workflow 4단계), 백엔드 이슈는 생략.

## 하위 이슈

### M15-0: 추적 이슈 (#392)
마일스톤 진행 체크리스트. 각 하위 이슈 완료 시 체크.

### M15-1: 집계 기반 — KST 버킷 헬퍼 · 지표 레지스트리 · history summary API · 기간 파라미터 (#393) — 우선순위 ★★★
- 범위: D4 · D5 전부. `src/lib/history/` (버킷, 레지스트리, 롤업), `/api/history/summary`, `/api/activities` `from/to`, `/api/export` `from/to`. 기존 인라인 월 시작·`kstDayRange` 중복을 신설 헬퍼로 교체 (#365 흡수 — 봇·lifestyle 라벨 잔여 포함).
- 백엔드 전용 → 디자인 단계 생략. 에이전트 사전 리뷰 필수 (API 경계).
- 완료 기준: 6년 전체 연 단위 summary 응답 1초 이내 (로컬 실측 기록).

### M15-2: `/history` 브라우저 — 연 · 월 · 일간 종합 (#394) — 우선순위 ★★★
- 범위: D1 · D2 · D3. 사이드바 "기록". 레벨 공용 네비 컴포넌트, 연 뷰(12개월 카드 + 지표 선택), 월 뷰(값 셀 그리드 + 월 KPI + 일별 스트립), 일간 종합 페이지 8 섹션.
- `MonthlyHeatmap` 을 강도값·라벨 prop 으로 일반화하거나 신규 `MonthGrid` 로 대체 (착수 시 판단, 기존 lifestyle 사용처 회귀 없어야 함).
- 디자인 단계 필수. M15-1 의존.

### M15-3: `/trends` 추이 분석 — 시계열 · YoY · 계절성 · 기간 비교 (#395) — 우선순위 ★★
- 범위: D6. `TrendLineChart` 라벨 포맷 prop. 디자인 단계 필수. M15-1 의존.

### M15-4: 하이라이트 — 개인 기록 · 이벤트 마커 · 포인트 링크 · 커버리지 띠 (#396) — 우선순위 ★★
- 범위: D7. `Activity.eventType` 컬럼 승격 + rawData 백필 스크립트 (스키마 변경 1건 → `prisma-drift-fix` 절차, 에이전트 리뷰 필수). M15-2 · M15-3 의존.

### M15-5: 심화 시각화 (#397) — 우선순위 ★
- 범위: D8 표에서 착수 시 3~4개 선별. 나머지는 이 이슈에 체크리스트로 남긴다. M15-3 의존.

## 제외 사항

- Garmin 신규 엔드포인트 싱크 (감사 D-1 ~ D-3, D-5 ~ D-7) — 별도 이슈. 이 마일스톤은 이미 있는 데이터만 쓴다.
- 기존 페이지 (`/`, `/activities` 등) 의 고정창을 기간 선택기로 바꾸는 것 — `/history`·`/trends` 가 그 역할을 맡는다. 필요하면 후속.
- 편집 기능 — 전부 읽기 전용.
- 식단 캘린더 (M14 백로그 B-2) — 월 뷰의 지표 하나 ("섭취 kcal") 로 흡수 가능. M15-2 착수 시 포함 여부 판단.
- 서버 측 materialized rollup 테이블 — 실측에서 느릴 때만.

## 릴리즈 계획

이슈 단위 minor. M15-1 은 UI 없이 API 만 나가므로 M15-2 와 같은 릴리즈로 묶어도 된다 (착수 시 판단).
