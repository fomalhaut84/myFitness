# [M15 #5] `/insights` 심화 시각화 — 효율 산점도 · 기온 vs 페이스 · 월별 HR 존 · 주간 km → 다음 주 RHR

- **작성일**: 2026-09-22
- **타입**: feature
- **이슈**: #397 (추적 #392 · 마일스톤 스펙 `docs/specs/m15-overview.md` D8)
- **브랜치**: `feat/397-1`
- **의존**: #393 (집계 계층 · 주 버킷) · #394/#395 (지표 색 · 판독값 띠 · 차트 토큰) · #396 (v2.33.0 — `eventType`, 레이스 배지에 재사용)

## 1. 배경

`/trends` 는 **지표 하나** 를 시간 축으로 본다. 그래서 "같은 페이스를 더 낮은 심박으로 뛰게 됐나", "제주 여름이 페이스를 얼마나 깎나", "많이 뛴 다음 주에 안정시 심박이 오르나" 같은 **두 필드의 관계** 는 답하지 못한다.
이 이슈는 이미 DB 에 있지만 어디에도 안 그려지는 필드로 그 질문 네 개에 답한다. D8 후보 11개 중 4개 선별 (2026-09-22 승인) — 러닝 중심 · 6년치 데이터가 실제로 있음 · 기존 화면과 중복 없음. 나머지는 이슈 #397 체크리스트에 남긴다.

읽기 전용 · 스키마 변경 없음 · 패키지 추가 없음 (Recharts `ScatterChart` 기존 패키지).

프로덕션 실측 (2026-09-22, 러닝 2,156건):

| 필드 | 건수 | 시작 | 비고 |
|---|---|---|---|
| `avgPace` + `avgHR` | 2,155 | 2020-06 | 효율 산점도 · 기온 산점도의 y |
| `weatherTempC` | 2,136 | 2020-06-19 | #269 백필 완료 |
| `zoneDistribution` | **606** | **2024-12-04** | M4-5 강도 백필이 #377 히스토리 백필 (2026-09-17) **전** 에 돌아 2020~2024-11 활동은 비어 있다 → §7 배포 전 확인 |
| `DailySummary.restingHR > 0` | 2,284일 | 2020-06-18 | 교차 상관의 y |

실코드 재검증:

| 지점 | 현황 |
|---|---|
| `ZoneDistribution` | `{ z1..z5 }` 초 단위 (`src/lib/fitness/intensity.ts`). 총합 60초 이하는 null. 존 색 5개는 활동 상세 (`activity-detail-client.tsx:223`) 에 정의 — 회복 `#a3a3a3` · 이지 `#22c55e` · 에어로빅 `#60a5fa` · 역치 `#f59e0b` · VO2max `#ef4444` |
| `backfill-intensity.ts` | `intensityLabel` 이 있으면 skip (`--force` 없이 재실행 안전). rawData `hrTimeInZone_1~5` 에서 계산 |
| 주 버킷 | `getCachedHistorySummary({ granularity: "week", metrics: ["runningKm", "restingHR"] })` — 주 = 월요일 시작 (#393) |
| 취침 · 기상 규칙성 | `/lifestyle` `SleepRegularity` 에 이미 있음 → 제외 근거 |
| Recharts Scatter | 사용처 없음 (계절성의 점은 선 없는 `Line`). `ScatterChart` + `Scatter` + `ZAxis` 를 이번에 처음 쓴다 — 타입 · 카테고리 vs 수치 축 동작을 `node_modules/recharts` 로 확인 |

## 2. 목표

1. 질문 4개가 **한 화면** 에서 답이 된다 — 차트 + 숫자 판독값 (차트만으로 끝내지 않는다).
2. 모든 가공은 `src/lib/insights/` 순수 함수 + vitest. 페이지 · 차트는 배열을 받아 그리기만.
3. 러닝 2,156건 산점도가 폰에서도 읽힌다 (점 크기 · 겹침 · 연도 토글).
4. 결측 · 커버리지가 낮은 달 (존 있는 러닝이 절반 미만) 이 "낮은 값" 으로 오독되지 않는다 (#395 원칙).

## 3. 요구사항

> **구현 완료 (PR #417 · v2.34.0, 2026-09-22).** 아래 문구는 착수 시점의 요구사항이고, 구현이 달라진 항목은 ↳ 로 표시했다.

**라우트 · 컨트롤**
- [x] F1 `/insights` 단일 페이지 (`force-dynamic` 서버 컴포넌트) · 사이드바 "분석" ("추이" 아래). 기간은 항상 **전체** (하한 ~ 오늘) — 산점도는 6년이 한 번에 보여야 연도 차이가 보인다. 컨트롤은 각 패널의 **연도 토글** (client state · URL 에 넣지 않음, YoY 와 같은 규칙) 뿐
- [x] F2 러닝 활동 조회는 한 번 (`loadInsightRuns`): `isRunningType` · `startTime ∈ [하한, 오늘]` · select `startTime, distance, duration, avgPace, avgHR, weatherTempC, weatherHumidityPct, zoneDistribution, eventType`. `getCachedInsightRuns()` 로 캐시 (기존 키 규칙 — 싱크 stamp · 수동 쓰기 버전)
- [x] F3 산점도 공통 필터: `distance ≥ 3,000m` (짧은 워밍업 · 트랙 반복이 점을 흐린다) · `avgPace ∈ [150, 900]` 초/km (GPS 튐 방어). 제외 건수를 캡션에 (`2,155건 중 2,010건`)

**A. 효율 산점도 — "같은 페이스, 더 낮은 심박?"**
- [x] F4 x = 평균 페이스 (초/km, **빠를수록 오른쪽** — 축 반전, 라벨 `5'00"`), y = 평균 심박 (bpm). 점 = 러닝 1건, **연도별 색 = YoY 규칙** (올해 지표색 `#f87171` 계열이 아니라 **심박 색** `#f87171` 굵게, 과거는 회색 사다리). 레이스는 속 빈 점
- [x] F5 판독값: **기준 페이스 구간** (5'00"~5'30"/km — 상수 1곳, 사용자 평균 페이스 근처) 의 **연도별 평균 심박** 표 (`2021 158 · 2022 155 · … · 2026 149`, n 병기). 구간에 5건 미만인 해는 `—`. 답이 되는 숫자 하나: "올해 vs 첫 해 −N bpm"
  - ↳ 표의 열은 러닝이 있는 해 전부 (구간에 러닝이 없는 해는 `—` n=0) — 기준 구간에 해당하는 해가 없어도 열이 비지 않게
- [x] F6 순수: `efficiencyPoints(runs)` · `efficiencyByYear(points, band)` (`src/lib/insights/efficiency.ts`)

**B. 기온 vs 페이스 — "여름이 페이스를 얼마나 깎나?"**
- [x] F7 x = 기온 (°C, `weatherTempC` — 체감 아님, 손목 온도 아님: memory `project_weather_wrist_separation`), y = 평균 페이스 (축 반전, 빠를수록 위). 점 색 = **습도 3단** (`< 50%` 어둡게 · `50~75%` · `> 75%` 밝게 — 단일 색조 `#fbbf24` 램프 · 범례). 습도 null 은 중간 단
- [x] F8 판독값: **5°C 구간별 중앙값 페이스** (`< 5 · 5~10 · … · 25~30 · ≥ 30`), n 병기, 5건 미만 구간 `—`. 답이 되는 숫자: "30°C 이상 vs 10~15°C +N초/km"
- [x] F9 순수: `weatherPoints(runs)` · `paceByTempBin(points)` (`src/lib/insights/weather.ts`). 중앙값 (평균 아님 — 이상치)

**C. 월별 HR 존 분포 — "강도 배분이 달라졌나?"**
- [x] F10 x = 월 (존이 있는 첫 달 ~ 이번 달, 빈 달 포함), y = 존 1~5 **시간 비율 (100% 스택)**. 색 = 활동 상세의 존 5색 그대로 (범주 색이라 "한 화면 한 지표 색" 예외 — 앱 안에서 이미 의미가 붙은 색). 툴팁 = 존별 시간 (h:mm) · 비율 · 존 있는 러닝 n/전체
- [x] F11 **커버리지**: 존이 있는 러닝이 그 달 러닝의 절반 미만이면 막대 흐리게 (#395 저커버리지 규칙 재사용, 기준 0.5 상수 공유). 러닝 0건 달은 빈 칸. 캡션에 `존 분포는 2024-12 부터` (실데이터 시작일 — 하드코딩 아님, 데이터에서)
- [x] F12 판독값: 최근 12개월 vs 그 전 12개월의 **존 1~2 비율** (이지 비율) · 존 4~5 비율. 답이 되는 문장: "이지 비율 62% → 71%"
- [x] F13 순수: `zoneShareByMonth(runs, ctx)` · `zoneShareCompare(months)` (`src/lib/insights/zones.ts`). 월 키 = `bucketKeyOf(ymd, "month")` (KST)

**D. 주간 km → 다음 주 안정시 심박 — "많이 뛴 다음 주에 심박이 오르나?"**
- [x] F14 주 버킷 summary (`runningKm` 합 · `restingHR` 평균, 전체 기간) → 쌍 `(km[w], rhr[w+1])`. **미완결 주 · RHR 커버리지 절반 미만 주 · 결측 제외**. x = 주간 km, y = 다음 주 평균 RHR. 점 색 = 연도 (YoY 규칙, 심박 색)
  - ↳ 산점도 점 클릭은 없음 (한 주는 활동 1건이 아니다) — `href: null`
- [x] F15 판독값: **피어슨 r** — 지연 0 (같은 주) · 지연 1 (다음 주) · 지연 2, n 병기. 절대값 0.1 미만 "관계 없음" · 0.1~0.3 "약함" · 0.3 이상 "있음" 문구 (통계 검정 아님 — 캡션에 명시). 주간 km 를 **4분위** 로 나눈 다음 주 RHR 평균 표 (`0~20km 49 · 20~35 50 · …`)
- [x] F16 순수: `lagPairs(weeks, lag)` · `pearson(pairs)` · `quartileTable(pairs)` (`src/lib/insights/lag.ts`)

**공통**
- [x] F17 각 패널 = 질문 제목 + 한 줄 설명 + 차트 + 판독값 띠 (`ReadoutRow` 재사용 · 표는 `CompareTable` 톤). 연도 토글은 YoY 의 범례 버튼 (`aria-pressed`)
  - ↳ 답 구조 = `BigNumber` (26px 숫자 하나) + `ValueTable` (근거 표) · C · D 의 r 은 `ReadoutRow` 3칸 (시안 결정 1)
- [x] F18 산점도 접근성: `role="img"` + 판독값 · 표가 같은 정보를 글자로. 점 클릭 → 활동 상세 (`/activities/<id>`) — 기록 페이지가 아니라 활동 1건이 대상. 정적 점 자체에 onClick (#396 교훈: 활성 점만으로는 안 된다) · 툴팁 커서 `pointer-events: none`
  - ↳ 축 포맷은 함수가 아니라 이름 (`"pace" | "int" | "degrees"`, `scatter-format.ts`) — 서버 → 클라이언트 경계에서 함수를 넘길 수 없다. 존 색 · 이름 상수도 `"use client"` 없는 `zone-colors.ts` (클라이언트 모듈의 비컴포넌트 export 는 서버에서 참조 프록시)
- [x] F19 한국어 UI · 다크 · 360px (차트 220px · 산점도 점 r 2 · 판독값 1열) · 단위 규칙 (페이스 `m'ss"` · bpm 정수 · °C 소수 없음 · km 소수 1자리)
- [x] F20 KST · ymd 헬퍼만 (`ymdKST` · `bucketKeyOf`). 신규 코드에 `new Date(y, m, d)` 금지
- [x] F21 순수 로직 (F6 · F9 · F13 · F16 · 필터 · 습도 단 · 온도 구간 · 중앙값) 전부 vitest
- [x] F22 성능: 러닝 2,156행 1회 조회 + 주 summary 1회 (캐시) — 콜드 목표 1s 이내, 웜 즉시

## 4. 기술 설계

### 4.1 데이터 흐름

```
/insights                          src/app/insights/page.tsx (server)
  ├ ctx = { today, lowerBound }
  ├ runs  = getCachedInsightRuns(ctx)                       src/lib/insights/load.ts  (activity 1회)
  ├ weeks = getCachedHistorySummary({ week, runningKm · restingHR, 전체 })  (기존 캐시)
  ├ A: efficiencyPoints(runs) → <EfficiencyScatter> + 연도별 기준 구간 표
  ├ B: weatherPoints(runs)    → <WeatherScatter>    + 온도 구간 중앙값 표
  ├ C: zoneShareByMonth(runs) → <ZoneStack>         + 12개월 비교 판독값
  └ D: lagPairs(weeks, 1)     → <LagScatter>        + r (지연 0/1/2) · 4분위 표
```

- 차트 4개만 `"use client"`. 가공은 서버 · 순수. 산점도 3개는 공통 `ScatterBase` 로 (축 · 툴팁 · 연도 토글 · 클릭) — 파일은 각각 두되 축 정의만 다르게.
- 연도 토글 상태는 차트마다 독립 (한 패널의 토글이 다른 패널에 영향 없음).

### 4.2 순수 모듈 (`src/lib/insights/`)

```ts
// types.ts
interface InsightRun { id; ymd; year; distanceM; durationSec; avgPace; avgHR: number|null; tempC: number|null; humidityPct: number|null; zones: ZoneDistribution|null; race: boolean }
// filter.ts
function usableRuns(runs, { minDistanceM: 3000, paceRange: [150, 900] }): { kept: InsightRun[]; dropped: number }
// efficiency.ts
function efficiencyPoints(runs): { id; year; pace; hr; race }[]
function efficiencyByYear(points, band: [number, number]): { year; n; avgHr: number|null }[]
// weather.ts
function humidityLevel(pct: number|null): 0|1|2
function weatherPoints(runs): { id; year; tempC; pace; humidity: 0|1|2 }[]
function paceByTempBin(points, binC = 5): { from; to; n; medianPace: number|null }[]
// zones.ts
function zoneShareByMonth(runs, ctx): { key; runs; withZones; lowCoverage; share: [z1..z5] | null; seconds: [..] }[]
function zoneShareCompare(months, today): { recent: { easy; hard }; previous: {...} } | null
// lag.ts
function lagPairs(weeks: SummaryBucket[], lag, ctx): { year; km; rhr }[]   // partial · lowCoverage · 결측 제외
function pearson(pairs): { r: number|null; n }
function quartileTable(pairs): { from; to; n; avgRhr }[]
```

- 중앙값 · 피어슨은 작은 유틸 (`stats.ts`) — 라이브러리 추가 없음.
- 저커버리지 판정은 `isLowCoverage` 를 그대로 쓰지 않고 (지표 def 의존) 비율 상수 `LOW_COVERAGE_RATIO` 를 `trends.ts` 에서 import.

### 4.3 차트

| 패널 | Recharts | 축 |
|---|---|---|
| A 효율 | `ScatterChart` + 연도별 `Scatter` | x 페이스 `reversed` · `type="number"` · 포맷 `m'ss"`, y bpm |
| B 기온 | `ScatterChart` + 습도 3단 `Scatter` | x °C `type="number"`, y 페이스 `reversed` |
| C 존 | `BarChart` `stackOffset="expand"` (100%) + `Cell` opacity | x 월 (카테고리, 라벨 규칙 = `formatBucketLabel`), y 0~100% |
| D 지연 | `ScatterChart` + 연도별 `Scatter` | x km, y bpm |

- `ScatterChart` 의 수치 축 domain 은 `["auto", "auto"]` + 여백 — `allowDataOverflow` 기본값 (memory `feedback_recharts_defaults`).
- 점 2,000개: `isAnimationActive={false}`, r=2.2 (데스크톱) / 2 (폰), fillOpacity 0.7 (겹침이 밀도로 보이게). 툴팁 = 날짜 · 페이스 · 심박 (또는 기온 · 습도) · 거리 · `클릭 → 활동`.
- 축 · 툴팁 포맷터는 순수 함수 (`chart-format.ts` 재사용 + 페이스 축 포맷 추가).

### 4.4 판독값

- A: 연도 × 평균 심박 표 (`CompareTable` 톤의 작은 표) + `ReadoutRow` 1칸 "올해 vs 첫 해".
- B: 온도 구간 × 중앙값 페이스 표 + "30°C 이상 vs 10~15°C".
- C: `ReadoutRow` 3칸 — 이지 비율 (최근 12개월 · 그 전 12개월 · 차이).
- D: `ReadoutRow` 3칸 — r (지연 0 · 1 · 2) + 4분위 표.

## 5. 변경 파일

```
신설
  src/app/insights/page.tsx
  src/lib/insights/types.ts · load.ts · filter.ts · stats.ts · efficiency.ts · weather.ts · zones.ts · lag.ts · index.ts
  src/lib/insights/__tests__/filter.test.ts · stats.test.ts · efficiency.test.ts · weather.test.ts · zones.test.ts · lag.test.ts
  src/components/insights/EfficiencyScatter.tsx · WeatherScatter.tsx · ZoneStack.tsx · LagScatter.tsx · InsightPanel.tsx · ValueTable.tsx · scatter-format.ts
  docs/designs/397-insights/ (preview.html · design-notes.md · screenshots/)
수정
  src/lib/history/cache.ts (insight runs 캐시) · src/components/layout/Sidebar.tsx ("분석")
  docs/roadmap.md (머지 후)
DB 마이그레이션: 없음. 패키지: 없음.
```

구현 순서: 시안 승인 → `types` · `filter` · `stats` (테스트 먼저) → `efficiency` · `weather` · `zones` · `lag` (테스트 먼저) → `load` + 캐시 → 페이지 + 패널 4개 → 사이드바 → 4종 검증 → 사전 에이전트 리뷰.

## 6. 테스트 계획

vitest:
- **filter**: 거리 · 페이스 범위 · null 처리 · 제외 건수
- **stats**: 중앙값 (짝수 · 홀수 · 빈) · 피어슨 (완전 상관 1 · 무상관 ≈ 0 · n < 3 → null)
- **efficiency**: 기준 구간 경계 (5'00" 포함 · 5'30" 제외) · 5건 미만 해 null · 레이스 플래그
- **weather**: 습도 3단 경계 (50 · 75 · null) · 온도 구간 (음수 · 30 이상 · 경계) · 중앙값
- **zones**: 월 키 KST · 비율 합 = 1 · 존 없는 달 null · 저커버리지 (1/3) · 빈 달 포함 · 12개월 비교 (이번 달 포함 규칙)
- **lag**: 지연 0/1/2 쌍 · 미완결 주 제외 · 저커버리지 주 제외 · 연 경계 넘김 · 4분위 경계

수동 (로컬 스텁 DB — 러닝 5건 · 존 5건 · RHR 0일): 빈 상태 4종 (문구) · 360px. 배포 후 (실데이터): §7.

## 7. 배포 전 · 후 확인

- **배포 전 확인 결과 (2026-09-22)**: `zoneDistribution` 이 없는 러닝 1,550건의 rawData 에 `hrTimeInZone_1` 이 **0건** — 목록 API 페이로드에 존이 없던 시기 (#377 히스토리 백필로 들어온 행). 존 패널은 **2024-12 부터** (캡션은 데이터에서). 과거 존은 활동별 API (`activity-service/activity/{id}/hrTimeInZones`, 1,550회 호출) 가 필요해 후속 후보로 남긴다.
- ~~배포 전 (프로덕션 psql)~~: 2020~2024-11 활동의 rawData 에 `hrTimeInZone_1` 이 있는지 — 있으면 `npm run backfill:intensity` 재실행 (skip 규칙이라 안전 · API 호출 0) 으로 존 스택이 2020-06 부터 채워진다. 없으면 존 패널은 2024-12 부터 (캡션 표기)
  ```bash
  psql "$DATABASE_URL" -Atc "select count(*) filter (where \"rawData\" ? 'hrTimeInZone_1') as has_zone_raw, count(*) as no_zone_col from \"Activity\" where \"zoneDistribution\" is null and \"activityType\" like '%running%';"
  ```
- **배포 후**: A 연도별 기준 구간 심박이 단조 감소하는지 (memory: 최고 컨디션 2023-11~2024-03) · B 30°C 이상 구간의 중앙값 페이스 · C 이지 비율 12개월 비교 · D r 값 3개 · 폰 360px · 점 클릭 → 활동 상세

## 8. 제외 사항

- D8 나머지 7개 후보 (케이던스 · 보폭 추세 → `/trends` 지표 등록으로 후속 · 요일/시간대 · 취침/기상 (이미 `/lifestyle`) · 수면 스택/SpO2 · 스트레스/바디배터리 · 체중 목표선 (`/body`) · 수면 → 다음날 페이스) — 이슈 #397 체크리스트에 남김
- 회귀선 · 신뢰구간 · 통계 검정 — 피어슨 r 과 구간 표까지만
- 기간 컨트롤 (1년 · 3년) — 전체 고정. 필요하면 후속
- 산점도 점의 키보드 접근 — #413 과 같은 범주 (판독값 · 표가 글자 경로)

## 9. 코드 리뷰 결과

- 사전 에이전트 리뷰 1회 (2026-09-22, pr-review-toolkit code-reviewer · worktree): critical 0 · major 1 · info 8
  - major 1: 효율 판독값 라벨이 "올해" 로 고정 — `efficiencyDelta.lastYear` 는 **평균이 있는 마지막 해** 라 연초 · 올해 구간 러닝 5건 미만이면 올해가 아니다 (지난해 값이 올해로 읽힘) → 라벨 · 캡션이 `lastYear` 를 읽는다. 회귀 `efficiency.test.ts`
  - info 반영 6: 클릭 불가 점의 `cursor: pointer` (D 패널) · C 패널 foot 문구 (이번 달은 비교에 포함) · 존 툴팁 시간 `Xh Xm` · 레이스 점이 연도 토글을 따르게 (`toggleId`) · 존 없는 달 점선 빈 칸 · 모바일 점 r 2 (CSS `r`) · `signed` 의 `−0.00` · 천 단위 표기
  - info 미반영 1 → **후속 이슈**: RSC 페이로드 — 점 4,300개의 툴팁 문자열 · href 를 서버에서 직렬화 (약 400~500KB). 원시값만 넘기고 클라이언트에서 조립
- Codex bot 1회차 (PR #417, 2026-09-22): P0/P1 0 · P2 1 → 반영. 러닝 조회가 `distance > 0 · avgPace > 0` 을 요구해 GPS 없는 트레드밀 러닝 (존은 있음) 이 존 패널의 비율 · 커버리지 (`withZones/runs`) 에서 빠짐 → 조회는 러닝 전부, 거리 · 페이스 조건은 `usableRuns` (산점도) 에서만 (`InsightRun.distanceM/avgPace` nullable · `UsableRun` 타입). 회귀 `filter.test.ts` · `zones.test.ts`. P2 만 반영이라 재리뷰 요청 없음
- Codex bot 2회차 (push 자동 재리뷰): P0/P1 0 · P2 2 → **후속 #419** (미반영). (1) 제외 사유 캡션에 "거리 없음" 누락 (2) 레이스 점이 흰색 단일 계열이라 여러 해 레이스가 연도 범례와 안 맞음. **종료 판단**: P2 만 2라운드 연속
- **최종**: 사전 critical/major 0/0 · 봇 P0/P1 0/0 · info 8건 (반영 7 · 후속 #419 1) · 봇 P2 3건 (반영 1 · 후속 #419 2)
- 릴리즈 PR #420 (v2.34.0): Codex 👍 (지적 없음)
- **배포 후 확인 (v2.34.0, 2026-09-22)**: Deploy success · 사용자 실데이터 확인 완료 (4 패널)
