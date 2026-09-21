# [M15 #3] `/trends` 추이 분석 — 시계열 · 전년 동기 (YoY) · 계절성 · 기간 비교

- **작성일**: 2026-09-21
- **타입**: feature
- **이슈**: #395 (추적 #392 · 마일스톤 스펙 `docs/specs/m15-overview.md` D6)
- **브랜치**: `feat/395-1`
- **의존**: #393 (집계 계층) · #394 (v2.31.0 — summary 캐시 · 지표 색 · 표시 형식 · `HistoryNav` 패턴)

## 1. 배경

`/history` (#394) 는 "그때 어땠더라" 를 **찾아가는** 화면이다. `/trends` 는 같은 집계 계층 위에서 **비교하는** 화면이다 —
지표 하나를 골라 주/월/연 단위로 길게 보고, 연도끼리 겹쳐 보고, 두 구간을 나란히 놓는다.
인계 문서의 실사용 질문 "컨디션이 가장 좋았던 시기" (답: 2023-11~2024-03) 를 AI 없이 UI 로 확인하는 것이 완료 기준의 하나다.

읽기 전용 · 스키마 변경 없음 · Garmin 호출 없음 · 패키지 추가 없음 (Recharts 3.8 기존).

실코드 재검증 (2026-09-21):

| 지점 | 현황 |
|---|---|
| `getCachedHistorySummary` | `granularity` week/month/year · `bucketSpan` 조회 · 빈 버킷 포함 · `coveredDays`/`totalDays` · avg 형 `min`/`max` · `last`. **임의 구간을 한 버킷으로 롤업하는 경로는 없다** — 기간 비교에 필요 |
| `rollup.ts` | 버킷 그룹핑이 `bucketKeyOf(ymd, granularity)` 고정. 집계 본체 (`aggregateValue` + min/max/last) 는 버킷과 무관하게 재사용 가능 |
| `src/components/ui/TrendLineChart.tsx` | 선 1개 · 일 라벨 `M/D` 하드코딩 · **`new Date(dateStr + "T00:00:00")` 로컬 TZ** · 밴드/막대 없음. 사용처 4곳 (dashboard · heart · body · RunningAnalysis) |
| 지표 표시 | `formatHistoryValue` · `historyDisplayUnit` · `format: "pace"` · `metricColor` — #394 에서 완비. 그대로 쓴다 |
| 하한 | `getCachedLowerBound()` (실데이터 2020-06-16). #405 (하한 > 오늘) 는 미해결 — 이 페이지도 `resolve` 입구에서 같은 값을 쓴다 |
| 사이드바 | 하위 경로 활성 판정 완료 (#394). "추이" 1건 추가만 |

## 2. 목표

1. 지표 × 단위 × 기간 × 뷰가 전부 **URL 쿼리** 에 있어 링크 하나로 같은 화면이 재현된다.
2. 뷰 4종: 시계열 · 전년 동기 (YoY) · 계절성 · 기간 비교.
3. 모든 값은 `getCachedHistorySummary` / 신설 구간 롤업 경유. 페이지·컴포넌트가 직접 reduce 하지 않고, 피벗 (YoY · 계절성) 은 순수 함수 + vitest.
4. 커버리지가 낮은 버킷이 "낮은 값" 으로 오독되지 않는다.

## 3. 요구사항

**라우트 · 컨트롤**
- [ ] F1 `/trends` 단일 페이지 (`force-dynamic` 서버 컴포넌트). 쿼리: `view=series|yoy|season|compare` (기본 `series`) · `metric` (기본 `runningKm`, selectable 만) · `unit=week|month|year` (기본 `month`) · `range=1y|3y|all` (기본 `3y`) · 비교 뷰 `a=YYYY-MM..YYYY-MM` · `b=…`. 잘못된 값은 **기본값으로 fallback** (redirect 없음 — 쿼리는 정규화하지 않는다)
- [ ] F2 `src/lib/history/trends-params.ts` (순수) — 쿼리 파싱 + `range` → `{ from, to }` (오늘 기준 역산 · 하한 클램프) + 비교 구간 파싱/기본값 (A = 직전 3개월 완결 월, B = 그 1년 전 같은 달들) + 기본값은 URL 에서 생략하는 쿼리 빌더
- [ ] F3 컨트롤 바: 뷰 탭 4 · 지표 선택 (`MetricPicker` 재사용 — basePath + 나머지 쿼리 보존하도록 일반화) · 단위/기간 세그먼트. 뷰에 의미 없는 컨트롤은 숨긴다 (YoY · 계절성은 단위 = 월 고정, 계절성 · 비교는 기간 컨트롤 없음)
- [ ] F4 사이드바 "추이" (`/trends`) — "기록" 아래

**시계열**
- [ ] F5 합계형 (`aggregate: "sum"`) 은 막대, 그 외는 선. avg + `withMinMax` 지표는 **min~max 밴드** (Area) + 평균선. `vo2max` (max + last) 는 최고선 하나
- [ ] F6 X 축 = 버킷 키. 라벨은 단위별 포맷 (주 `3/11` · 월 `24.03` · 연 `2024`), 연 경계에 연도 표시. 버킷이 연속 (빈 버킷 포함) 이라 **카테고리 축이 등간격 = 실제 시간 간격** — `scale="time"` 불필요 (memory `feedback_recharts_defaults` 의 "카테고리 축 등간격 함정" 은 포인트가 빠질 때의 문제)
- [ ] F7 결측 버킷은 선이 **끊긴다** (`connectNulls={false}`). 합계형 `missingAsZero` 의 0 은 0 막대
- [ ] F8 **저커버리지**: `missingAsZero` 가 아닌 지표에서 `coveredDays / totalDays < 0.5` 인 버킷은 흐리게 (막대 opacity · 선은 속 빈 점). 기준값은 상수 1곳. 툴팁에 `N/M일 기록` 표기
- [ ] F9 툴팁: 버킷 라벨 (기간) · 값 (`formatHistoryValue` + `historyDisplayUnit`) · min/max (있으면) · 커버리지. **포인트 클릭 → `/history` 링크는 #396** (이 이슈는 툴팁 안 텍스트 링크까지만 — 월 버킷 → 월 뷰, 연 버킷 → 연 뷰)
- [ ] F10 요약 줄: 기간 전체 값 (구간 롤업 — F15) · 최고 버킷 · 최저 버킷 (결측·저커버리지 제외)

**YoY · 계절성**
- [ ] F11 YoY: 전체 기간 월 버킷 → 연도별 12칸 피벗 (`pivotByYear`, 순수). x = 1~12월, 연도별 선. **올해는 지표색 굵은 선, 과거는 회색 계열 (최근일수록 밝게)**. 범례 클릭으로 연도 토글 (client state — URL 에 넣지 않는다)
- [ ] F12 YoY 미완결 월 (이번 달 · 하한이 걸친 첫 달) 은 합계형에서 **점선/속 빈 점** — 부분 합계가 "적게 뛴 달" 로 읽히지 않게
- [ ] F13 계절성: 월별 (1~12) 대표값 12개 막대 + 연도별 점 (분포). 대표값 규칙 = 합계형: 완결 월들의 **월 합계 평균** / 평균형: `coveredDays` **가중 평균** / max 형: 최고 / last 형: 월 값 평균. 기여 연도 수를 막대 아래 표기 (`n=6`)
- [ ] F14 피벗·계절성 규칙은 `src/lib/history/trends.ts` 순수 함수 + vitest

**기간 비교**
- [ ] F15 `src/lib/history/range-totals.ts` — `getHistoryRangeTotals({ from, to, metrics })`: 구간 전체를 **한 버킷** 으로 롤업 (평균의 평균 금지 — #394 KPI 와 같은 원칙). `rollup.ts` 의 집계 본체를 `aggregatePoints(points, def)` 로 추출해 공유. 캐시 경유 (`cache().get`)
- [ ] F16 비교 뷰: 구간 A · B 를 `<input type="month">` 4개 (uncontrolled + `key` — #394 major 1) 로 선택 → KPI 7종 (`buildHistoryKpis`) + 선택 지표를 **A | B | 차이** 3열 표로. 차이는 부호 + 단위, 페이스는 초 차이. 좋고 나쁨 색은 넣지 않는다 (지표마다 방향이 다르다 — 심박은 낮을수록, 거리는 높을수록)
- [ ] F17 구간 길이가 다르면 합계형 옆에 **월평균** 을 병기 (5개월 vs 3개월 합계 비교가 오독되지 않게)
- [ ] F18 구간 검증: 형식 오류 · 역순 · 하한 이전 · 미래 → 기본 구간 fallback. 최대 길이 제한 없음 (연 단위 비교 허용)

**공통**
- [ ] F19 한국어 UI · 다크 테마 · 모바일 (360px 에서 차트 가로 스크롤 없이 축소, 컨트롤은 가로 스크롤 pill) · 수치 단위 규칙
- [ ] F20 KST · ymd 헬퍼만. 신규 코드에 `new Date(y, m, d)` · `formatDateLocal` 금지
- [ ] F21 SpO2 관련 지표는 이번 선택기에 없다 (레지스트리 미등록) — 추가 시 임계 색 금지 원칙 유지
- [ ] F22 성능: 전 기간 주 단위 (약 330 버킷) 시계열 웜 응답이 캐시로 즉시. 콜드는 단일 지표라 소스 1개 조회 (#393 실측 155ms 수준)

## 4. 기술 설계

### 4.1 데이터 흐름

```
/trends?view=…                      src/app/trends/page.tsx (server)
  ├ parseTrendsQuery (순수)          src/lib/history/trends-params.ts
  ├ series → getCachedHistorySummary({ granularity: unit, from, to, metrics: [metric] })
  ├ yoy/season → getCachedHistorySummary({ granularity: "month", from: lowerBound, to: today, metrics: [metric] })
  │              → pivotByYear / seasonality (순수)         src/lib/history/trends.ts
  ├ compare → getHistoryRangeTotals × 2 (KPI 지표 + 선택 지표)
  └ 직렬화 가능한 view model → client 차트 컴포넌트 (Recharts)
```

- 차트 컴포넌트만 `"use client"`. 데이터 가공은 전부 서버/순수 함수 — 컴포넌트는 받은 배열을 그리기만 한다.
- YoY 와 계절성은 같은 summary (전체 기간 · 월) 를 쓴다 → 캐시 엔트리 1개 공유.
- 컨트롤은 전부 `<Link>` (서버 네비게이션, `scroll={false}`). client state 는 YoY 연도 토글뿐.

### 4.2 view model (`trends.ts`)

```ts
interface TrendPoint { key: string; label: string; value: number | null; min?: number | null; max?: number | null;
                       coveredDays: number; totalDays: number; lowCoverage: boolean; partial: boolean; href: string | null }
function toTrendPoints(buckets, def, ctx): TrendPoint[]              // 시계열
function pivotByYear(monthBuckets, def, ctx): { years: number[]; rows: { month: 1..12; [year]: value|null }[]; partial: Set<"YYYY-MM"> }
function seasonality(monthBuckets, def, ctx): { month; value|null; n; points: { year; value }[] }[]
function summarizeSeries(points, def): { best: TrendPoint|null; worst: TrendPoint|null }   // 결측·저커버리지·partial 제외
```

- `partial` = 버킷 달력 범위가 `[lowerBound, today]` 에 완전히 들어가지 않는 버킷 (첫 버킷 · 현재 버킷). 합계형에서만 표시에 쓴다.
- `lowCoverage` = `!def.missingAsZero && totalDays > 0 && coveredDays / totalDays < LOW_COVERAGE_RATIO (0.5)`. 체중처럼 **원래 드문 측정** (372건/6년) 은 월 단위에서 거의 전부 저커버리지가 된다 → `body` 소스는 기준을 "1일 이상" 으로 (`coveredDays === 0` 만 결측, 흐림 없음). 레지스트리에 `sparse: boolean` 을 두지 않고 `trends.ts` 의 소스별 규칙으로 시작 — 두 번째 예외가 생기면 레지스트리로 승격.
- 라벨 포맷은 순수 함수 `formatBucketLabel(key, granularity)` — 테스트 대상.

### 4.3 구간 롤업 (F15)

`rollup.ts`: 기존 버킷 루프의 본체를 `aggregatePoints(points, def): BucketValue` 로 추출 (동작 동일 — 기존 테스트가 회귀 방어). `range-totals.ts` 는 `loadDailyPoints(from, to, ids)` → 지표별 `aggregatePoints` → `{ values, totalDays }`. 월 입력이므로 from = 그 달 1일, to = 그 달 말일 (오늘 · 하한으로 클램프).

### 4.4 차트 컴포넌트

| 컴포넌트 | Recharts | 비고 |
|---|---|---|
| `TrendSeriesChart` | `ComposedChart` — `Bar` 또는 `Area`(밴드: `[min, max]` range) + `Line` | 저커버리지: `Bar` 는 `Cell` opacity, `Line` 은 커스텀 dot |
| `YoyChart` | `LineChart` — 연도별 `Line` | 범례 토글 state. partial 구간은 별도 점선 `Line` (같은 색) |
| `SeasonalityChart` | `ComposedChart` — `Bar` + `Scatter` (연도별 점) | |
| `CompareTable` | 없음 (표) | 서버 컴포넌트 |

- Y 축 domain: 합계형 `[0, "auto"]`, 그 외 `["auto", "auto"]` (min~max 에 여백). `domain` 을 데이터가 따르게 두므로 `allowDataOverflow` 는 건드리지 않는다 (memory).
- 페이스 지표 (`ltPace`) 는 Y 축을 **뒤집는다** (`reversed`) — 빠를수록 위. 축·툴팁 포맷은 `formatHistoryValue`.
- 축 포맷터 · 툴팁 포맷터는 순수 함수로 분리해 테스트 (memory 의 How to apply).
- 밴드용 `Area` 의 `dataKey` 는 `[min, max]` 튜플 — Recharts 3 의 range area 동작은 구현 전 `node_modules/recharts` 타입/문서로 확인 (추측 금지).

### 4.5 `TrendLineChart` — 이슈 요구와 다르게 간다

이슈는 "`TrendLineChart` 에 라벨 포맷 prop 추가" 였다. `/trends` 는 막대 · 밴드 · 다중 선이 필요해 **전용 차트를 새로 만들므로 그 prop 의 사용처가 없다.** 쓰지 않는 prop 을 추가하지 않는다. 대신 같은 파일의 실결함 하나를 고친다:
`formatDay` 의 `new Date(dateStr + "T00:00:00")` (브라우저 로컬 TZ 파싱) → 문자열 슬라이스 (`M/D`) 로. 사용처 4곳의 표시는 KST 브라우저에서 동일, 비 KST 에서만 달라진다 (#365 의 클라이언트 컴포넌트 잔여 1건 흡수).

### 4.6 `MetricPicker` 일반화

현재 `href = basePath + historyMetricQuery(id)`. `/trends` 는 다른 쿼리 (`view` · `unit` · `range` · `a` · `b`) 를 보존해야 한다 → `hrefFor: (id) => string` prop 으로 바꾸고 `/history` 호출부 2곳을 맞춘다. 서버 컴포넌트 → 서버 컴포넌트라 함수 prop 가능.

## 5. 변경 파일

```
신설
  src/app/trends/page.tsx
  src/components/trends/TrendsControls.tsx · TrendSeriesChart.tsx · YoyChart.tsx · SeasonalityChart.tsx
                        · CompareTable.tsx · ComparePeriodForm.tsx · SeriesSummary.tsx · chart-format.ts
  src/lib/history/trends-params.ts · trends.ts · range-totals.ts
  src/lib/history/__tests__/trends-params.test.ts · trends.test.ts · range-totals.test.ts · chart-format.test.ts
  docs/designs/395-trends/ (preview.html · design-notes.md · screenshots/)
수정
  src/lib/history/rollup.ts (aggregatePoints 추출) · cache.ts (range totals 캐시) · index.ts
  src/components/history/MetricPicker.tsx (hrefFor) · src/app/history/[year]/page.tsx · [year]/[month]/page.tsx
  src/components/ui/TrendLineChart.tsx (로컬 TZ 파싱 제거)
  src/components/layout/Sidebar.tsx ("추이")
  docs/roadmap.md (머지 후)
DB 마이그레이션: 없음. 패키지: 없음.
```

구현 순서: 시안 승인 → `aggregatePoints` 추출 (기존 테스트 green 유지) → `range-totals` (테스트 먼저) → `trends-params` · `trends` (테스트 먼저) → `MetricPicker` 일반화 → 페이지 + 컨트롤 → 시계열 → YoY → 계절성 → 비교 → Sidebar · `TrendLineChart` → 4종 검증 → 사전 에이전트 리뷰.

## 6. 테스트 계획

vitest:
- **trends-params**: 기본값 · 잘못된 값 fallback · `range` → from/to (1y = 오늘 포함 12개월, 하한 클램프) · 비교 구간 파싱 (형식 · 역순 · 미래 · 하한 이전 → 기본) · 기본 구간 계산 (연 경계 넘김) · 쿼리 빌더가 기본값 생략 · selectable 아닌 metric fallback
- **trends**: `pivotByYear` (연 경계 · 빈 연도 · partial 표시) · `seasonality` 규칙 4종 (합계형은 partial 월 제외 · 평균형 가중 평균 · max · last) + `n` · `toTrendPoints` 의 lowCoverage/partial/body 예외 · `summarizeSeries` 가 결측·저커버리지 제외 · `formatBucketLabel`
- **range-totals**: 구간 평균이 월 평균의 평균과 다름 (가중) · 합계 · last · 빈 구간 · `aggregatePoints` 추출 후 기존 `rollup.test.ts` 무변경 통과
- **chart-format**: 축/툴팁 포맷터 — number 지표 · pace 지표 · null

수동 (로컬 스텁 DB) · 배포 후 (실데이터):
- 4 뷰 × 대표 지표 (러닝 km · 수면 점수 · 체중 · VO2max · ltPace) 렌더, 쿼리 공유 링크 재현
- 360px 폭 · 툴팁 · YoY 연도 토글
- **실사용 확인**: 비교 뷰에서 2023-11~2024-03 vs 최근 5개월 — 체중 · VO2max · 페이스가 `/ai` 답변 (인계 문서) 과 일치
- `/history` 지표 전환 회귀 (MetricPicker 변경) · dashboard/heart/body 의 `TrendLineChart` 회귀

## 7. 제외 사항

- 개인 기록 · 이벤트 마커 (MetricChange · TrainingPlan · 레이스) · 차트 **포인트 클릭** → 일 뷰 · 커버리지 띠 — #396
- 효율 산점도 · HR 존 · 기상 · 수면 규칙성 · 교차 상관 — #397
- 다중 지표 동시 비교 (2축) — 필요 시 후속
- 일 단위 시계열 — `/history` 월 뷰 스트립이 맡는다
- #405 (하한 > 오늘) · #403 (프로세스 간 캐시) — 별도 이슈
- `TrendLineChart` 에 라벨 포맷 prop (§4.5 — 사용처 없음)

## 8. 코드 리뷰 결과

- 사전 에이전트 리뷰 1회 (2026-09-21): critical 0 · major 3 · info 8
  - major 1: `unit=year|week` × `range=1y|3y` 에서 summary 는 첫 버킷을 달력 전체로 조회해 **막대는 기간 밖 데이터를 포함하는데 "기간 전체" 판독값은 포함하지 않아** 어긋남 → `resolveTrendsRange` 가 `from` 을 단위의 버킷 시작으로 스냅, 연 단위는 항상 전체 기간 (기간 컨트롤 숨김). 회귀 `trends-params.test.ts`
  - major 2: `SeasonalityChart` custom shape — Recharts 는 custom shape 가 있으면 값 없는 막대를 걸러내지 않고 스케일이 null 을 0 으로 읽어, 결측 달에 "값 0" 위치로 가로선이 그려짐 (음수 도메인 지표에서 보임) → shape 에서 `payload.value` 가 number 일 때만 그림. 회귀 `trends.test.ts` (결측 달은 null 유지)
  - major 3: `partial` 한 플래그가 "이번 버킷" 과 "기록 시작일이 걸린 첫 버킷" 을 묶어 6년 전 달이 "아직 끝나지 않은 월 / 진행 중" 으로 표시됨 + YoY 점선이 뒤로만 이어져 첫 달이 고립 점 → `PartialReason = "current" | "clipped"` 로 분리 · 문구 분기, `buildYoyRows` 순수 함수로 추출해 앞뒤 양쪽 연결. 회귀 `trends.test.ts`
  - info 반영 6: 캐시 주석 정정 · dense 축 라벨 복구 (주 × 1년에서 라벨 1개만 남던 문제) · `compare.ts` 도달 불가 분기 정리 · **월평균을 명목 월 수가 아니라 실제 조회 일수 기준으로** · 비교 구간 입력이 무효일 때 원래 값으로 되돌림 · 주 버킷 `/history` 링크를 주 가운데 날의 달로
  - info 미반영 2: 데이터 1년 미만일 때 기본 비교 구간 A/B 겹침 (프로덕션은 6년치 — 안내 문구는 후속) · F13 의 "기여 연도 수를 막대 아래 표기" 는 툴팁 · 판독값 캡션으로 축소 (§9)
- Codex bot: PR 오픈 후

## 9. 시안 · 스펙 대비 구현 차이

- F9: 툴팁에 `/history` 링크 없음 — 툴팁은 포인터를 따라다녀 클릭할 수 없다. 차트 아래 판독값 (최고/최저 버킷) 의 기간 표기가 링크. 포인트 클릭 이동은 #396.
- F2: 기본 비교 구간은 **A = 1년 전 같은 달들, B = 직전 완결 3개월** (스펙 문구와 A/B 가 반대) — 표가 `B − A` = "그때 대비 지금" 으로 읽히게.
- F13: 기여 연도 수는 막대 아래가 아니라 툴팁 (`9월 · 6개 해`) 과 판독값 캡션에.
- F1/F3: 연 단위는 기간 선택 없이 항상 전체 (major 1).
- 그릴 값이 없는 뷰는 빈 축 대신 이유를 말하는 문장 (스펙에 없던 추가).
