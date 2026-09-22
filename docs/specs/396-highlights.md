# [M15 #4] 하이라이트 — 개인 기록 · 이벤트 마커 · 포인트 → `/history` 링크 · 커버리지 띠 · `Activity.eventType` 승격

- **작성일**: 2026-09-22
- **타입**: feature
- **이슈**: #396 (추적 #392 · 마일스톤 스펙 `docs/specs/m15-overview.md` D7)
- **브랜치**: `feat/396-1`
- **의존**: #394 (v2.31.0 — `/history` · summary 캐시 · 지표 색) · #395 (v2.32.0 — `/trends` · `TrendPoint.href` · `ReadoutRow`)

## 1. 배경

`/history` 는 찾아가는 화면, `/trends` 는 비교하는 화면이다. 둘 다 **값** 만 보여준다 — 2023-10 에 페이스가 왜 빨라졌는지 (LTHR 갱신? 플랜? 레이스?) 는 차트가 말해주지 않는다.
이 이슈는 값의 변화에 **원인** 을 붙이고 (이벤트 마커), 6년치에서 **최고점** 을 날짜와 함께 꺼내고 (개인 기록), 차트에서 **그 날로** 바로 가게 한다 (포인트 클릭).

M15 의 유일한 스키마 변경 — 레이스는 Garmin 활동의 `eventType.typeKey === "race"` 에만 있고 지금은 `rawData` 안에 묻혀 있다.

실코드 · 실데이터 재검증 (2026-09-22):

| 지점 | 현황 |
|---|---|
| `Activity.eventType` | 컬럼 없음. `src/` 어디에도 `eventType` 을 읽는 코드 없음 (`rawData.eventType.typeKey` 만 존재). **프로덕션 분포: `uncategorized` 2,320 · `race` 14 · `training` 1** (HM 9 · 10K 5, 2021-03 ~ 2025-11). 로컬 DB 는 활동 5건 (전부 `uncategorized`) |
| 컬럼 추가 선례 | `routeTag` (#261) — nullable `TEXT` + 단독 인덱스, 수동 SQL 마이그레이션 (`20260722022724_activity_route_tag`) |
| 파서 분리 선례 | `src/lib/garmin/parse-running-dynamics.ts` — fetcher (`fetchers/activities.ts:57`) 와 백필 (`scripts/backfill-running-dynamics.ts`) 이 공유. 백필은 `--limit / --after-id / --dry-run` + composite cursor `{startTime, id}` |
| `running-buckets.ts` | `src/mcp/tools/` 아래 (`bucketOf` · `formatPace`). 웹 페이지가 `src/mcp/` 를 import 하지 않으므로 `src/lib/` 로 옮긴다 |
| "best" 계산 | `pace-progression.ts` · `race-prediction.ts` 의 best 는 **창(windowDays) 안** 최저 avgPace. 전 기간 개인 기록은 없다. 최고 VO2max 는 `fitness-metrics.ts` `bestOf` (plateau 처리), 최저 RHR 은 전용 함수 없음 (`DailySummary.restingHR`) |
| `MetricChange` | 컬럼명은 `field` (`maxHR` · `lthr` · `lthrPace` · `vo2maxRunning` · `restingHRBase`), `changedAt`. 스펙의 "maxHR · LTHR" = `maxHR` · `lthr` |
| `TrainingPlan` | `startDate` · `endDate` (`@db.Date`, KST day) · `targetDistance` · `targetDate` · `status` |
| `/history` 셀 링크 | 연 뷰 월 카드 → 월 뷰, 월 뷰 `MonthGrid` · `DayStrip` → 일 뷰 — **이미 완료 (#394)**. 남은 것은 `/trends` 차트 3종 (`onClick` 없음, `TrendPoint.href` 는 판독값 캡션에서만 소비) |
| `bucketHref` (`trends.ts:88`) | 비-export. `day` 분기 없음 · **지표 쿼리 없음** (릴리즈 PR #409 Codex P2 → 이 이슈에 편입) |
| `get_data_coverage` | 로직이 `src/mcp/tools/coverage.ts` 에만. `verify-mcp-long-history` 가 이 파일의 `_context` 문구를 소스 검사하므로 **집계만** `src/lib` 로 옮기고 문구는 MCP 에 남긴다 |
| 캐시 | `cache().get(key, loader)` — 키에 `max(lastSyncAt)` + 수동 쓰기 버전 + today 가 자동으로 섞인다. 개인 기록 · 마커 · 커버리지도 같은 경로 |

## 2. 목표

1. 레이스가 DB 컬럼이 된다 — 이후 페이스 진척 · 레이스 예측 · PR 이 "레이스" 를 구분할 수 있는 기반.
2. `/trends` 시계열 위에서 "이 변화 앞에 무슨 일이 있었나" 가 보인다 (마커 3종 + 기간 안 이벤트 목록).
3. 개인 기록 7종이 날짜 · 링크와 함께 한 화면에 있다. AI 없이 "HM 최고 기록이 언제였지" 가 답이 된다.
4. `/trends` 의 모든 포인트가 `/history` 로 이어지고, 링크가 선택 지표를 잃지 않는다.
5. `/history` 에서 "무슨 데이터가 언제부터 있나" 가 보인다.

## 3. 요구사항

**A. `Activity.eventType` 승격 (스키마 · 싱크 · 백필)**
- [ ] F1 `Activity.eventType String?` + `@@index([eventType, startTime])`. 값은 Garmin `eventType.typeKey` **원문 그대로** (`race` · `training` · `uncategorized` …), 없으면 `null`. 수동 SQL 마이그레이션 (`prisma-drift-fix`) — `routeTag` 선례 그대로 nullable · additive
- [ ] F2 `src/lib/garmin/parse-event-type.ts` — `parseEventType(raw): string | null` (순수). 빈 문자열 · 비문자열은 `null`. `fetchers/activities.ts` 의 `data` 객체에 `eventType` 추가 (create · update 양쪽 — Garmin 에서 나중에 레이스로 바꿔도 다음 싱크에 반영)
- [ ] F3 `scripts/backfill-event-type.ts` + `npm run backfill:event-type`. `--dry-run` · `--limit N` · `--after-id <cuid>` (composite cursor) · `--force` (이미 값 있어도 덮어씀). 기본은 `eventType IS NULL` 행만. 종료 시 값 분포 로그. 배포 후 사용자가 1회 실행 (2,335행 · API 호출 0)
- [ ] F4 `Activity` 의 `eventType` 은 `loadDailyPoints` (히스토리 집계) 에 넣지 않는다 — 레이스는 별도 조회 (F9)

**B. 개인 기록 (`/trends?view=records`)**
- [ ] F5 `/trends` 5번째 뷰 탭 `개인 기록 — 역대 최고는?`. 이 뷰에서는 지표 pill · 단위 · 기간 컨트롤을 **숨긴다** (지표와 무관한 화면 — 395 의 "뷰에 의미 없으면 숨긴다")
- [ ] F6 `src/lib/history/records.ts` — `getPersonalRecords(ctx)`: 순수 랭킹 함수 + 조회 함수 분리
  - 5K · 10K · HM · FM 최고: `activityType contains "running"` · `distance` · `avgPace` 있는 활동 → `bucketOf(distance)` 별 **최저 avgPace** (동률이면 먼저 달성한 날). 값 = 페이스 (`m:ss/km`) + 소요 시간 (`h:mm:ss`) + 거리. FM 은 기록 없으면 "기록 없음"
  - 최장 거리: 러닝 `max(distance)`
  - 최다 km 월: 전체 기간 월 summary (`runningKm`) 의 최대 버킷 — 캐시 엔트리는 YoY · 계절성과 공유
  - 최고 VO2max: `FitnessMetricDaily.vo2maxRunning` 최대 · **처음 도달한 날** (`bestOf` 의 plateau 는 MCP 용 — 여기서는 첫 도달일 하나. 캡션에 "N일 유지" 는 넣지 않는다)
  - 최저 RHR: `DailySummary.restingHR` 최소 (`> 0` — stub 방어) · 처음 도달한 날
- [ ] F7 각 기록 = 라벨 · 값 · 날짜 · 링크 (`/history/Y/M/D`, 최다 km 월은 `/history/Y/M`). 러닝 기록이 **레이스** 활동이면 `레이스` 배지. 표시는 `ReadoutRow` 와 같은 토큰 (판독값 띠) — 7칸이라 3열 그리드 (모바일 1열)
- [ ] F8 **레이스 목록**: 같은 뷰 아래에 `eventType = "race"` 활동 전부 (최신순) — 날짜 · 이름 · 거리 · 페이스 · 시간 · 일 뷰 링크. 이름이 Garmin 기본값 (`달리기` · `러닝` · `10km 러닝`) 인 것도 그대로 (이름을 지어내지 않는다). 0건이면 "레이스로 표시된 활동이 없다 — Garmin 에서 활동 유형을 레이스로 바꾸면 다음 싱크에 반영" 안내
- [ ] F9 결과는 `getCachedPersonalRecords()` (`cache().get("records", …)`) — 싱크 · 수동 쓰기 · 날짜 변경 시 자동 무효화 (기존 키 규칙)

**C. 이벤트 마커 (`/trends` 시계열)**
- [ ] F10 `src/lib/history/markers.ts` — `loadEventMarkers({ from, to })` (조회) + `toChartMarkers(events, buckets, granularity)` (순수)
  - 소스 3종: `MetricChange` (`field ∈ {maxHR, lthr}`, `changedAt` → KST ymd, `oldValue → newValue`) · `TrainingPlan` (`startDate ~ endDate`, `targetDistance` · `status` 무관 — archived 도 과거 사실) · 레이스 (`Activity.eventType = "race"`: `startTime` → ymd · 이름 · 거리)
  - 날짜 → 버킷 키 = `bucketKeyOf(ymd, granularity)`. 조회 범위 밖 · 버킷 목록에 없는 키는 버린다. 플랜은 `{ fromKey, toKey }` (시작/끝을 각각 클램프)
  - **같은 버킷에 이벤트가 여럿이면 선 하나 + 라벨 합침** (연 단위에서 레이스 3개가 겹쳐 그려지지 않게)
- [ ] F11 `TrendSeriesChart` — 레이스 = 실선 `ReferenceLine` (`#d4d4d4`) + 상단 짧은 라벨 (`R`) · `MetricChange` = 점선 `ReferenceLine` (`#737373`) · 플랜 = `ReferenceArea` (`#ffffff` 6%). **지표 색을 쓰지 않는다** (한 화면 한 지표 색 — 마커는 무채색). 툴팁 하단에 그 버킷의 이벤트 문장 (`레이스 · 2024 아름다운 제주 국제마라톤 21.06km` / `LTHR 157 → 160`)
- [ ] F12 차트 아래 **"이 기간의 이벤트" 목록** (최신순, 최대 30건 · 초과 시 "외 N건"): 날짜 · 종류 배지 · 설명 · 링크 (레이스 → 일 뷰 · 플랜 → `/training` · 지표 변경 → `/settings/profile`). 차트가 `role="img"` 라 마커의 접근 가능한 대응물이 이 목록이다
- [ ] F13 토글: 쿼리 `marks=0` 으로 끔 (기본 켜짐 · 기본값은 URL 에서 생략). 컨트롤 바 시계열에서만 `이벤트 마커` pill 1개. 범례 한 줄: `│ 레이스 · ┆ maxHR · LTHR 변경 · ▒ 트레이닝 플랜`
- [ ] F14 YoY · 계절성 · 비교 뷰에는 마커 없음 (x 축이 달력 순서가 아니다)

**D. 포인트 → `/history` 링크**
- [ ] F15 `bucketHref` — export · `historyMetricQuery(def.id)` 부착 (릴리즈 PR #409 Codex P2) · `day` granularity 는 `historyDayPath`. 회귀 테스트: 비기본 지표의 href 에 `?metric=` 이 있다
- [ ] F16 `TrendSeriesChart` — `Bar` / `Line` 활성 포인트 클릭 → `router.push(point.href)` (`useRouter`). 커서 `pointer`. 툴팁 마지막 줄 `클릭 → 월 뷰` / `연 뷰` (버킷 단위에 따라). 주 버킷은 그 주 목요일이 속한 달 (#395 기존 규칙)
- [ ] F17 `YoyChart` 포인트 클릭 → `/history/YYYY/MM?metric=` · `SeasonalityChart` 연도별 점 클릭 → 같은 경로 (`YoyRow` 에 연도 · 월이 있으므로 컴포넌트에서 `historyMonthPath` 로 조립 — `route-params` 는 순수 lib 라 client import 가능, `MonthGrid` 선례)
- [ ] F18 판독값 캡션 링크 (`ReadoutRow`) 는 그대로 — 키보드 · 스크린리더 경로

**E. 커버리지 띠 (`/history` 연 뷰)**
- [ ] F19 `src/lib/history/coverage.ts` — `getCoverageRanges()` (prisma 집계 8종, MCP 에서 이동) + 순수 `buildCoverageStrip(ranges, ctx)` → 소스별 `{ id, label, oldest, newest, count, startPct, endPct }` (하한 ~ 오늘 축 기준). MCP `coverage.ts` 는 `getCoverageRanges` 를 import 해 기존 반환 shape (`types` · `syncCoverage` · `_context`) 유지 — `verify:mcp-long-history` 무변경 통과
- [ ] F20 `CoverageStrip` 컴포넌트 — `/history/[year]` 의 `MetricPicker` 아래 · `KpiRow` 위. 접힌 한 줄 `2020.06 ~ 2026.09 · 활동 2,332건 · 일간 요약 … ` + 네이티브 `<details>` 로 펼치면 소스별 가로 막대 (하한 → 오늘 축, 무채색 · 지표 색 없음). 표시 소스 8: 활동 (러닝 건수 병기) · 일간 요약 · 수면 · 체중 · 피트니스 지표 · **야간 HRV** (`SleepRecord.hrvOvernight not null`) · **혈압** · **식단** (`FoodLog`). 기존 5개 소스는 실데이터에서 전부 2020-06 시작이라 막대가 똑같다 — 범위가 실제로 다른 뒤 3개가 띠에 정보를 준다 (시안 결정 6)
- [ ] F21 `getCachedCoverage()` — `cache().get("coverage", …)`. 월 · 일 뷰에는 넣지 않는다

**공통**
- [ ] F22 한국어 UI · 다크 · 모바일 360px (마커 라벨은 모바일에서 숨기고 목록으로) · 수치 단위 규칙 (페이스 `m:ss/km` · 거리 km 소수 2자리)
- [ ] F23 KST · ymd 헬퍼만. `MetricChange.changedAt` · `Activity.startTime` → `ymdKST`. `TrainingPlan` 날짜는 `@db.Date` → 기존 `plan-detail.ts` 의 변환 규칙 재사용
- [ ] F24 순수 로직 (랭킹 · 마커 버킷 매핑 · 커버리지 shape · `parseEventType` · 쿼리 파싱) 전부 vitest

## 4. 기술 설계

### 4.1 데이터 흐름

```
/trends?view=series&marks=…        src/app/trends/page.tsx (server)
  ├ parseTrendsQuery (+ view=records · marks)              trends-params.ts
  ├ SeriesView → summary (기존) + loadEventMarkers({from,to}) → toChartMarkers(…, buckets, unit)
  │              → <TrendSeriesChart points markers onClick→router.push> + <EventList>
  └ RecordsView → getCachedPersonalRecords() → <RecordsPanel> + <RaceTable>

/history/[year]                    src/app/history/[year]/page.tsx
  └ getCachedCoverage() → buildCoverageStrip → <CoverageStrip>   (연 뷰만)

Garmin 싱크                        fetchers/activities.ts  data.eventType = parseEventType(raw)
백필                               scripts/backfill-event-type.ts  (rawData → eventType, 커서형)
```

### 4.2 `eventType` 마이그레이션

```sql
-- #396: Activity.eventType — Garmin eventType.typeKey ("race" · "training" · "uncategorized" …) 컬럼 승격.
-- Nullable · additive. 기존 행은 backfill:event-type (rawData 에서, API 호출 0).

ALTER TABLE "Activity"
  ADD COLUMN "eventType" TEXT;

CREATE INDEX "Activity_eventType_startTime_idx" ON "Activity"("eventType", "startTime");
```

`prisma-drift-fix` 절차: schema 편집 → 수동 SQL → `psql -f` → `_prisma_migrations` INSERT → `prisma generate` → typecheck. 프로덕션은 `deploy.sh` 의 `migrate deploy` 가 적용.

### 4.3 개인 기록 (`records.ts`)

```ts
interface RecordRow { id: RecordId; label: string; value: string; unit?: string; detail?: string; ymd: string | null; href: string | null; race?: boolean }
function rankRunningRecords(activities: readonly RunningRow[]): { byBucket: Record<Bucket, RunningRow | null>; longest: RunningRow | null }   // 순수
function pickFirstExtreme<T>(rows, value, direction): T | null   // 동률 → 먼저 달성한 날 (순수)
async function getPersonalRecords(ctx): Promise<PersonalRecords>   // 조회 + 조립
```

- 러닝 조회는 `select { id, startTime, name, distance, duration, avgPace, eventType }` · `distance ≥ 4500m` (버킷 하한) 으로 좁혀 행 수를 줄인다. 최장 거리는 `orderBy distance desc take 1` 별도 조회 (버킷 밖 거리도 대상).
- 소요 시간은 `duration` (초) — `h:mm:ss`. 페이스는 `avgPace` (`formatPace`). 두 값이 서로 다른 활동에서 오지 않는다 (같은 행).
- 최다 km 월은 `getCachedHistorySummary({ granularity: "month", from: lowerBound, to: today, metrics: ["runningKm"] })` — 버킷 `value` 최대 (`partial` 제외 안 함: 이번 달이 최다면 사실이다. 캡션에 `이번 달 (진행 중)`).

### 4.4 마커 (`markers.ts`)

```ts
type EventKind = "race" | "metric" | "plan";
interface HistoryEvent { kind; ymd; endYmd?: string; title: string; detail?: string; href: string | null }
interface ChartMarker { key: string; kind: "line"; events: HistoryEvent[]; label: string }        // 레이스 · 지표 변경 (같은 버킷 합침)
interface ChartBand   { fromKey: string; toKey: string; kind: "band"; event: HistoryEvent }         // 플랜
function toChartMarkers(events, bucketKeys: readonly string[], granularity): { lines: ChartMarker[]; bands: ChartBand[] }
```

- 버킷 키 집합에 없는 이벤트는 버린다 (조회 범위는 summary 와 같은 `from..to` 지만, 첫 버킷이 하한 앞으로 걸치는 주/연 단위를 위해 키 기준으로 한 번 더 거른다).
- 레이스 + 지표 변경이 같은 버킷 → `ChartMarker.events` 2개, 선은 레이스 스타일 우선 (실선), 라벨 `R+1`.
- 플랜 `endYmd < from` 또는 `ymd > to` 면 제외. 걸친 플랜은 `fromKey = bucketKeys[0]` 로 클램프.

### 4.5 차트 변경 (`TrendSeriesChart`)

| 항목 | Recharts |
|---|---|
| 레이스 · 지표 변경 | `<ReferenceLine x={key} stroke strokeDasharray label={{ value, position: "top", fontSize: 10 }} />` — 카테고리 축에서 `x=버킷 키` 동작은 연 경계선으로 검증됨 |
| 플랜 | `<ReferenceArea x1={fromKey} x2={toKey} fill="#fff" fillOpacity={0.06} stroke="none" />` |
| 클릭 | `Bar onClick={(d) => push(d.href)}` · `Line activeDot={{ onClick }}` — 둘 다 payload 에 `href` 가 있다 (`TrendPoint`). `ComposedChart onClick` 은 `activePayload` 의존이라 쓰지 않는다. **구현 전 `node_modules/recharts` 타입으로 이벤트 시그니처 확인** (추측 금지) |
| 툴팁 | 기존 `content` 에 `markersByKey.get(key)` 문장 + `클릭 → 월 뷰` 줄 |

마커 · 밴드는 `isAnimationActive={false}` 유지. 시안 단계에서 마커가 데이터 선을 가리지 않는지 (연 단위 · 76개 월 버킷) 확인.

### 4.6 `running-buckets` 이동

`src/mcp/tools/running-buckets.ts` → `src/lib/running/buckets.ts` 로 옮기고 MCP 쪽 파일은 재-export 만 남긴다 (`pace-progression` · `race-prediction` · `training-plan` 등 7곳 import 무변경). MCP 번들 (esbuild) 은 `@/lib` 를 이미 끌어온다 (`prisma` · `garmin/utils`).

### 4.7 커버리지 (`coverage.ts`)

MCP `getDataCoverage()` 의 `Promise.all` 9개 중 집계 8개를 `src/lib/history/coverage.ts` `getCoverageRanges()` 로 옮기고 (`Range { oldest, newest, count }` 그대로), 웹 띠용으로 HRV (`sleepRecord` where `hrvOvernight not null`) · `foodLog` 집계 2개를 더한다 — MCP 반환에는 넣지 않는다 (도구 shape 무변경). `syncMetadata` 조회 · `syncCoverage` · `_context` 문구 · `MAX_QUERY_DAYS` 는 MCP 에 남는다. `buildCoverageStrip(ranges, { lowerBound, today })` 는 `startPct = days(lowerBound → oldest) / days(lowerBound → today) × 100` — `oldest < lowerBound` 면 0 (하한은 5개 모델 최초일이라 원칙적으로 없지만 심박 · 혈압은 하한 계산에 안 들어간다).

### 4.8 `trends-params`

- `TRENDS_VIEWS` 에 `"records"` 추가. `marks: boolean` (기본 `true`, `marks=0` 만 false). `buildTrendsQuery` 는 기본값 생략 유지.
- `records` 뷰는 `metric` · `unit` · `range` 를 URL 에 남겨두되 (다른 탭에 다녀와도 유지 — F1 ↳ 규칙) 컨트롤은 숨긴다.

## 5. 변경 파일

```
스키마 · 싱크 · 백필
  prisma/schema.prisma (Activity.eventType + index) · prisma/migrations/<ts>_activity_event_type/migration.sql
  src/lib/garmin/parse-event-type.ts (신설) · src/lib/garmin/fetchers/activities.ts (data.eventType)
  scripts/backfill-event-type.ts (신설) · package.json (backfill:event-type)
lib
  src/lib/running/buckets.ts (이동) · src/mcp/tools/running-buckets.ts (재-export)
  src/lib/history/records.ts · markers.ts · coverage.ts (신설)
  src/lib/history/trends.ts (bucketHref export · day · metric query) · trends-params.ts (records · marks) · cache.ts (records · coverage) · index.ts
  src/mcp/tools/coverage.ts (집계를 lib 에서 import)
UI
  src/app/trends/page.tsx (RecordsView · SeriesView 마커 · EventList)
  src/components/trends/TrendsControls.tsx (탭 5 · 마커 pill · records 에서 컨트롤 숨김)
                        TrendSeriesChart.tsx (마커 · 밴드 · onClick) · YoyChart.tsx · SeasonalityChart.tsx (onClick)
                        RecordsPanel.tsx · RaceTable.tsx · EventList.tsx · MarkerLegend.tsx (신설)
  src/components/history/CoverageStrip.tsx (신설) · src/app/history/[year]/page.tsx
테스트
  src/lib/garmin/__tests__/parse-event-type.test.ts
  src/lib/history/__tests__/records.test.ts · markers.test.ts · coverage.test.ts · trends.test.ts (bucketHref) · trends-params.test.ts (records · marks)
문서
  docs/designs/396-highlights/ (preview.html · design-notes.md · screenshots/) · docs/roadmap.md (머지 후)
DB 마이그레이션: 1건 (additive). 패키지: 없음.
```

구현 순서: 시안 승인 → `running-buckets` 이동 (테스트 green) → 스키마 + 파서 + fetcher + 백필 (테스트 먼저) → `bucketHref` (회귀 테스트 먼저) → `records.ts` → `markers.ts` → `coverage.ts` + MCP 연결 → `trends-params` → 차트 onClick · 마커 → RecordsView · EventList → CoverageStrip → 4종 검증 → 사전 에이전트 리뷰.

## 6. 테스트 계획

vitest:
- **parse-event-type**: `{ eventType: { typeKey: "race" } }` → `"race"` · 누락 · 빈 문자열 · 비객체 → `null`
- **records**: 버킷별 최저 페이스 · 동률 → 먼저 달성한 날 · 버킷 밖 거리 무시 · FM 없음 → null · 최장 거리 · 레이스 플래그 전달 · 최다 km 월 (`partial` 포함)
- **markers**: ymd → 버킷 키 (주 · 월 · 연) · 범위 밖 제거 · 같은 버킷 합침 (라벨 `R+1`) · 플랜 클램프 · `lthrPace` 등 대상 아닌 field 제외
- **coverage**: `startPct`/`endPct` 계산 · `oldest < lowerBound` 클램프 · 0건 소스
- **trends** (회귀 · PR #409 Codex P2): `bucketHref(bucket, "month", weight)` 에 `?metric=weight` · 기본 지표는 쿼리 없음 · `day` → 일 경로
- **trends-params**: `view=records` 파싱 · `marks=0` → false · 기본 생략

수동 (로컬 스텁 DB — 레이스 0건 · 플랜 · MetricChange 5건 있음):
- 로컬 백필 dry-run · 실행 (5행 `uncategorized`), `prisma migrate status` clean
- `/trends?view=records` 빈 상태 (레이스 0건 안내) · 마커 (MetricChange 2026-04-27 이 월 버킷에 점선) · 포인트 클릭 → 월 뷰 지표 유지 · `marks=0`
- `/history/2026` 커버리지 띠 접힘 · 펼침 · 360px
- MCP `get_data_coverage` 반환 동일 (`verify:mcp-long-history` 통과)

배포 후 (실데이터):
- `npm run backfill:event-type -- --dry-run` → 실행 → 분포 `race 14 · training 1 · uncategorized 2320`
- `/trends?view=records`: HM 최고 · 10K 최고 · 레이스 14건 목록 (2022-11-06 평화의섬 ~ 2025-11-16 감귤)
- 시계열 `ltPace` · 연 단위에 레이스 선 겹침 없음 (2023 · 2024 · 2025 는 각 3건) — 합침 라벨 확인
- 다음 일일 싱크 후 새 활동의 `eventType` 채워짐

## 7. 제외 사항

- D-4 의 나머지 컬럼 (`movingDuration` · `activityTrainingLoad` · `trainingEffectLabel` · GAP) — 별도 이슈
- Garmin `personalrecord-service` 연동 (감사 D 표 7순위) — Garmin 이 계산한 PR 이 아니라 DB 활동에서 직접 계산
- 레이스 결과 (공식 기록 · 순위) 입력 — 없음. Garmin 활동 시간이 기준
- 페이스 진척 · 레이스 예측 MCP 도구의 레이스 필터 활용 — 컬럼이 생긴 뒤 후속 (#397 이후)
- `/history` 월 · 일 뷰 커버리지 띠 · 일 뷰 이벤트 표시 — 필요 시 후속
- YoY · 계절성 마커 (F14)
- 효율 · HR 존 · 기상 · 수면 규칙성 · 교차 상관 — #397

## 8. 코드 리뷰 결과

(구현 후 기록)
