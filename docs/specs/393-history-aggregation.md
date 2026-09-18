# [M15 #1] 집계 기반 — KST 버킷 헬퍼 · 지표 레지스트리 · history summary API · 기간 파라미터

- **작성일**: 2026-09-18
- **타입**: feature
- **이슈**: #393 (추적 #392 · 마일스톤 스펙 `docs/specs/m15-overview.md` D4 · D5)
- **브랜치**: `feat/393-1`

## 1. 배경

M15 의 `/history` (#394) · `/trends` (#395) 가 공유할 집계 계층. 지금은 월·연 집계 함수가 `src/lib` 에 없고
(주간 롤업은 `weight-trend.ts:78 summarizeWeek` 와 두 페이지의 인라인 8주 루프뿐), API 도 기간을 못 받는다.

실코드 재검증 (2026-09-18):

| 지점 | 현황 |
|---|---|
| `src/mcp/tools/aggregate.ts` | #377 의 daily/weekly/monthly 버킷 (`bucketKeyKST`, ISO 주 `YYYY-Www`) + `aggregateDaily` (**평균만**, 데이터가 있는 버킷만 반환). 연 단위 없음. 합계·최고·기간 말 없음. MCP 3개 도구가 소비 |
| `src/lib/date.ts` | `MIN_HISTORY_YMD`, `parseHistoryYmd`, `startOfWeekKST`/`endOfWeekKST`/`weekStartKST` (Date 기반). 월·연 시작 없음 |
| `src/app/nutrition/page.tsx:30` · `src/app/lifestyle/page.tsx:18` | `kstDayRange` / `kstDayRangeFor` 가 `KST_OFFSET_MS` 상수와 함께 **중복 정의** |
| `src/app/lifestyle/page.tsx:11,42-44,85,94` | `daysAgoLocal` (서버 로컬 자정) · `monthStart = new Date(now.getFullYear(), now.getMonth(), 1)` (서버 로컬) · `formatDateLocal(a.startTime)` 을 **Set key** 로 사용 → 히트맵·꾸준함 **카운트**가 서버 TZ 에 따라 바뀜 (#365 표 "높음") |
| `src/app/activities/page.tsx:10,19-21` | `weeksAgo` 서버 로컬 · KST 월 시작을 `toLocaleString` 왕복으로 ad-hoc 계산 |
| `src/app/api/activities/route.ts` | `type` · `limit`(1..100) · `offset` 만. `from/to` 없음 |
| `src/app/api/export/route.ts` | `type` 만. 전체 테이블 덤프. 날짜 셀·파일명이 `formatDateLocal` (서버 로컬) |
| `npm run test` | **verify 스크립트 5개만.** `workflow.md` 8-5 는 회귀 테스트를 vitest `src/**/__tests__/**/*.test.ts` 로 쓰라고 하지만 vitest 는 **도입된 적이 없다** (`git log -S vitest -- package.json` 0건) |

## 2. 목표

1. 지표별 집계 규칙을 **레지스트리 한 곳**에 두고, 순수 함수 롤업 + Prisma 조회를 분리한다.
2. `GET /api/history/summary` 로 클라이언트 지표 전환을 지원하고, 서버 컴포넌트는 같은 lib 함수를 직접 호출한다.
3. 페이지에 흩어진 KST 날짜 산술을 신설 헬퍼로 모은다 (#365 의 **페이지 인라인 부분** 흡수).
4. 집계 정책에 vitest 회귀 테스트를 건다 — 이 이슈에서 vitest 를 도입한다 (§4.7).

## 3. 요구사항

- [ ] F1 `src/lib/history/buckets.ts` — `HistoryGranularity = "day" | "week" | "month" | "year"`, `kstDayRange(ymd)`, `startOfMonthYmd` / `startOfYearYmd` / `startOfWeekYmd`(월요일), `bucketKeyOf(ymd, g)`, `enumerateBuckets(fromYmd, toYmd, g)` — **달력 기준으로 빈 버킷도 생성**, 각 버킷 `{ key, startYmd, endYmd(exclusive), start, end, totalDays }`
- [ ] F2 `src/lib/history/metrics.ts` — 지표 레지스트리 (§4.2). 초기 11개. 지표 추가 = 항목 1건
- [ ] F3 `src/lib/history/rollup.ts` — 순수 함수. 일별 포인트 `{ ymd, value }[]` + 버킷 + 집계 규칙 → `{ value, coveredDays, totalDays, min?, max? }`. 결측 제외, 합계형 `missingAsZero` 는 0
- [ ] F4 `src/lib/history/load.ts` — Prisma 조회 (rawData 제외 · 필요한 컬럼만) → 일별 포인트. 활동은 KST 일 단위로 먼저 접는다 (km 합계 · 횟수)
- [ ] F5 `src/lib/history/lower-bound.ts` — `getHistoryLowerBound()` = `max(MIN_HISTORY_YMD, 5개 모델 최초 기록일 최소값)` (PR #398 Codex P2)
- [ ] F6 `src/lib/history/summary.ts` — `getHistorySummary({ granularity, from, to, metrics })` (F1~F5 조합) + `parseSummaryParams` (순수 검증)
- [ ] F7 `GET /api/history/summary` — 파라미터 검증 실패 400 `{ error }`, 성공 §4.4 응답. 단위 포함
- [ ] F8 `/api/activities` `from` / `to` (KST 달력일 inclusive) 추가. 형식 오류·역순 400
- [ ] F9 `/api/export` `from` / `to` 추가 + 날짜 셀·파일명 `ymdKST` 로 교체
- [ ] F10 페이지 정리 — nutrition·lifestyle 의 중복 `kstDayRange` → F1, lifestyle `monthStart`/`daysAgoLocal`/`formatDateLocal` Set key → KST 헬퍼, activities `monthStart`/`weeksAgo` → KST 헬퍼. **동작 변화는 "서버 로컬 → KST" 뿐** (서버가 KST 면 무변화)
- [ ] F11 vitest 도입 (`vitest` devDependency · `vitest.config.ts` · `npm run test` 앞에 `vitest run`) + 회귀 테스트 §6
- [ ] F12 완료 기준 실측: 6년 전체 `granularity=year` · 전 지표 요청 응답 시간 기록 (목표 1초 이내). **로컬 실측 (2026-09-18, 스텁 DB 활동 5 · 수면 7 · fitness 306행): 40ms.** 6년치는 배포 후 프로덕션에서 기록

## 4. 기술 설계

### 4.1 버킷 (F1)

- 모든 계산은 **KST 달력 문자열 `YYYY-MM-DD`** 로 하고, DB 비교 instant 는 `new Date(\`${ymd}T00:00:00+09:00\`)` 로만 만든다 (`todayKST` 패턴). `Date.UTC(...) - KST_OFFSET_MS` 인라인은 없앤다.
- 버킷 키 = 시작일 문자열: day `2024-03-15`, week `2024-03-11` (월요일), month `2024-03`, year `2024`. 정렬 가능하고 UI 라벨로 바로 쓴다. MCP 의 ISO `YYYY-Www` 와 다르지만 MCP 는 건드리지 않는다 (§7).
- `enumerateBuckets` 는 `from` 이 속한 버킷부터 `to` 가 속한 버킷까지 **빈 버킷 포함** 생성. 첫/끝 버킷은 달력 전체 (`from` 으로 자르지 않는다 — 월 뷰가 "3월 1일~31일" 을 기대). `totalDays` 는 버킷 달력 일수, 단 오늘 이후는 세지 않는다 (`min(end, tomorrowKST)`).
- 윤년: 2024-02 = 29일. 주 경계: 일요일은 6일 전 월요일 (`startOfWeekKST` 와 동일 규칙).

### 4.2 지표 레지스트리 (F2)

```ts
type HistoryAggregate = "sum" | "avg" | "max" | "last";
interface HistoryMetricDef {
  id: HistoryMetricId; label: string; unit: string; decimals: number;
  source: "activity" | "daily" | "sleep" | "body" | "fitness";
  aggregate: HistoryAggregate;
  missingAsZero: boolean;   // sum 형 활동 지표만 true
  withMinMax: boolean;      // avg 형 중 밴드 표시 대상
}
```

| id | 소스 · 필드 | 집계 | 단위 | 비고 |
|---|---|---|---|---|
| runningKm | Activity.distance (isRunningType) / 1000 | sum | km 2자리 | missingAsZero |
| runningCount | Activity (isRunningType) | sum | 회 | missingAsZero |
| steps | DailySummary.steps | sum | 보 | 일평균은 클라이언트가 value/coveredDays |
| activeCalories | DailySummary.activeCalories | sum | kcal | |
| sleepScore | SleepRecord.sleepScore | avg | 점 | withMinMax |
| restingHR | DailySummary.restingHR | avg | bpm 정수 | withMinMax |
| hrv | SleepRecord.hrvOvernight | avg | ms | |
| stress | DailySummary.avgStress | avg | | |
| weight | BodyComposition.weight | avg | kg 1자리 | `last` 도 응답 (§4.4 `last` 필드) |
| vo2max | FitnessMetricDaily.vo2maxRunning | max | | `last` 병기 |
| ltPace | FitnessMetricDaily.lthrPace | last | sec/km | |

- 활동은 `startTime` 의 KST 날짜로 접는다. 하루 2회 러닝은 km 합·횟수 2.
- `weight`/`vo2max` 는 규칙이 avg/max 여도 응답에 `last` (기간 말 값) 를 같이 준다 — m15-overview D4 "병기".

### 4.3 롤업 (F3) · 조회 (F4)

- `rollup(points, buckets, def)`: 버킷별로 `ymd` 가 `[startYmd, endYmd)` 인 포인트를 모아 규칙 적용. 입력 불변, 새 배열 반환.
  - `coveredDays` = 값이 있는 날 수. `missingAsZero` 면 값 없는 날은 0 으로 세되 coveredDays 는 **실제 값 있는 날** (러닝 0회 월도 "기록 없음"이 아니라 0 이므로 UI 는 sum 형에서 coveredDays 를 흐림 판정에 쓰지 않는다 — 응답의 `def.missingAsZero` 로 판단).
  - 모든 출력값(value · min · max · last)을 `decimals` 로 반올림 (평균선이 밴드 밖으로 나가지 않게 — 사전 리뷰 info 2). min/max 는 `withMinMax` 만.
  - last: 버킷 안 최신 ymd 의 값.
- `loadDailyPoints(spanFrom, spanTo, metricIds)`: 소스별로 **한 번씩만** 조회 (같은 소스의 지표는 select 를 합친다). **조회 범위는 `from`/`to` 가 아니라 `bucketSpan(buckets)` (첫 버킷 시작 ~ 끝 버킷 마지막 날)** — §4.1 의 "첫/끝 버킷은 달력 전체" 와 맞추기 위해. from/to 로 조회하면 `?from=2024-03-15` 의 `2024-03` 버킷이 15일치 부분 합계가 되면서 `totalDays: 31` 로 나가 저커버리지 달로 오독된다 (사전 리뷰 major 1 · 회귀 `__tests__/summary.test.ts`). 하한 이전·오늘 이후는 행이 없어 무해. `where: { date: { gte: spanStart, lt: spanEndExclusive } }`. Activity 는 `startTime` 범위 + `activityType` 은 `isRunningType` 을 JS 에서 적용 (`contains: "run"` 필터는 `RUNNING_TYPES` 와 어긋날 수 있어 안 쓴다).
- 규모: 6년 전체 시 Activity 2,332 · Daily 2,300 · Sleep 2,300 · Body 372 · Fitness 2,000 행, 컬럼 3~5개. 캐시 없음 (m15-overview D5).

### 4.4 API (F6 · F7)

`GET /api/history/summary?granularity=month&from=2024-01-01&to=2024-12-31&metrics=runningKm,weight`

- 검증 (`parseSummaryParams`, 순수):
  - `granularity` ∈ 4종. `from`/`to` 는 `parseHistoryYmd` 규칙 (형식·실존·미래 아님). `from > to` → 400.
  - `from < lowerBound` → **클램프** 후 응답 `clampedFrom: true` (범위 밖을 400 으로 막으면 연 뷰 첫 해 링크가 깨진다). `to > today` → today 로 클램프.
  - `metrics` 생략 = 전체 (구분자만 있는 `metrics=,` 도 동일). 미등록 id → 400. 형식·순서 오류는 하한 DB 조회 전에 걸러낸다.
  - `granularity=day` 는 최대 366일 (버킷 폭주 방지) → 초과 400.
- 응답:

```json
{
  "granularity": "month", "from": "2024-01-01", "to": "2024-12-31", "clampedFrom": false,
  "lowerBound": "2020-06-16",
  "metrics": { "runningKm": { "label": "러닝 거리", "unit": "km", "aggregate": "sum", "missingAsZero": true } },
  "buckets": [
    { "key": "2024-01", "start": "2024-01-01", "end": "2024-02-01", "totalDays": 31,
      "values": { "runningKm": { "value": 112.34, "coveredDays": 14 },
                  "weight": { "value": 71.2, "coveredDays": 9, "min": 70.4, "max": 72.1, "last": 70.9 } } }
  ]
}
```

- 실패는 `{ error: string }` (api-routes 규칙). 날짜는 ISO 문자열.

### 4.5 `/api/activities` · `/api/export` (F8 · F9)

- `from`/`to` = KST 달력일 inclusive → `startTime: { gte: kstDayRange(from).start, lt: kstDayRange(to).end }`. 하나만 줘도 된다. 형식 오류·`from > to` 400. 없으면 기존 동작.
- export: 같은 필터. `formatDateLocal` → `ymdKST` (CSV 날짜 셀 3곳 + 파일명 2곳). `total` 은 activities 응답에 유지.

### 4.6 페이지 정리 (F10)

| 파일 | 변경 |
|---|---|
| `nutrition/page.tsx` | `KST_OFFSET_MS` · `kstDayRange` 삭제 → `kstDayRange` import |
| `lifestyle/page.tsx` | `KST_OFFSET_MS` · `kstDayRangeFor` · `daysAgoLocal` 삭제 → `kstDayRange` · `daysAgoKST`; `monthStart` → `kstDayRange(startOfMonthYmd(todayKSTString())).start`; 85·94 `formatDateLocal` → `ymdKST`; 135 는 라벨 (수면 date 는 KST 자정 instant) → `ymdKST` |
| `activities/page.tsx` | `weeksAgo` 삭제 → `weekStartKST(8)` 계열 또는 `daysAgoKST(56)`; `monthStart` → 헬퍼 |

동작 차이는 서버 TZ 가 KST 가 아닐 때만 생기며 그 경우가 #365 의 버그다. 각 페이지는 로컬 실행으로 렌더 확인.

### 4.7 vitest 도입 (F11)

- `workflow.md` 8-5 · `branch-workflow` Step 6 이 vitest 를 전제하는데 저장소에 없다. 집계 정책은 스크립트보다 단위 테스트가 맞는 대상이라 여기서 도입한다.
- `vitest` ^4 (devDependency — 5.x 는 Node 22 필요, CI/서버는 Node 20) · `vitest.config.mts` (`.ts` 는 `"type": "module"` 이 없어 CJS 로 로드되고 Node 20.18 은 `require(esm)` 이 없어 실패 → `.mts`) · `resolve.alias @ → ./src` · `include: ["src/**/__tests__/**/*.test.ts"]` · `environment: node` · `"test": "vitest run && npm run verify:..."`. ESLint 는 `src/` 를 이미 훑고, `tsc` 는 `**/*.ts` 를 포함하므로 테스트 파일도 typecheck 된다.
- **`overrides.postcss`: `"$postcss"` → `"^8.5.10"`** (devDependency 와 같은 스펙). npm 10.8 arborist 가 새 패키지 해석 중 peer set 에서 `$ref` 를 못 풀어 `Unable to resolve reference $postcss` 로 `npm install` 자체가 실패했다. 리터럴로 바꾸면 해결되고 `npm audit` 0건 유지. `$esbuild` 는 같은 경로를 타지 않아 그대로.
- 기존 verify 스크립트 5개는 그대로 (스크립트로만 잡을 수 있는 소스 스캔 포함).
- `package.json` 변경 → `Security Audit` 워크플로우가 push 마다 돈다. 머지 전 `gh workflow run "Security Audit" --ref feat/393-1` 로 확인.

## 5. 변경 파일

```
신설
  src/lib/history/buckets.ts · metrics.ts · rollup.ts · load.ts · lower-bound.ts · summary.ts · index.ts
  src/lib/history/__tests__/buckets.test.ts · rollup.test.ts · summary-params.test.ts · metrics.test.ts
  src/app/api/history/summary/route.ts
  vitest.config.ts
수정
  src/app/api/activities/route.ts · src/app/api/export/route.ts
  src/app/nutrition/page.tsx · src/app/lifestyle/page.tsx · src/app/activities/page.tsx
  package.json · package-lock.json
  docs/specs/393-history-aggregation.md (이 문서) · docs/roadmap.md (M15-1 체크)
DB 마이그레이션: 없음. 패키지: vitest.
```

구현 순서: F11 (테스트 러너) → F1 → F2 → F3 (테스트 먼저) → F5 · F4 → F6 → F7 → F8 · F9 → F10 → F12 실측.

## 6. 테스트 계획

vitest (`src/lib/history/__tests__/`):
- buckets: 월 경계 KST (`2024-03-01` 이 `2024-02` 에 안 들어감) · 윤년 2024-02 = 29일 · 일요일 → 그 주 월요일 · 연 버킷 · `enumerateBuckets` 가 빈 버킷 포함 · 오늘 이후 `totalDays` 미산입 · 첫 버킷을 `from` 으로 자르지 않음
- rollup: sum / avg(+min·max·반올림) / max / last · null 제외 · `coveredDays` · `missingAsZero` 0 · 입력 불변
- summary-params: granularity 오류 · from>to · 미래 to 클램프 · lowerBound 클램프 플래그 · 미등록 metric · day 366일 초과
- metrics: 레지스트리 id 유일 · 소스별 필드가 실제 Prisma 타입 키 (컴파일 타임 `satisfies` 로 보강)

수동:
- 로컬 `curl "/api/history/summary?granularity=year&from=2020-01-01&to=2026-09-18"` 응답 시간 · `clampedFrom` · `lowerBound`
- `/api/activities?from=&to=` · `/api/export?type=activities&from=&to=`
- `/nutrition` `/lifestyle` `/activities` 렌더 회귀 (로컬 DB 스텁이라 값은 적음 — 오류 없음·경계값만 확인)
- 4종 검증 + `Security Audit` 수동 실행

## 7. 제외 사항

- `src/mcp/tools/aggregate.ts` 통합 — MCP 는 ISO 주 키 · 평균 전용으로 이미 3개 도구가 의존. 이번엔 손대지 않고, `/history` 가 안정된 뒤 MCP 가 `src/lib/history` 를 쓰도록 별도 정리 (후속 후보로 #392 에 메모).
- #365 의 **봇 `toLocaleDateString` · `ecosystem.config.js` TZ 고정 · 클라이언트 컴포넌트 `"use client"` · verify 스캔 범위 확장** — 페이지 인라인 밖이라 #365 에 남긴다. 이 PR 머지 후 #365 본문에 처리된 행을 표시.
- 메모리 캐시 / materialized rollup — F12 실측이 느릴 때만.
- UI — #394 · #395.

## 8. 코드 리뷰 결과

- 사전 에이전트 리뷰 1회 (2026-09-18): critical 0 · major 1 · info 5
  - major 1: 버킷은 달력 전체인데 조회가 from/to → 첫/끝 버킷 부분 합계. **반영** — `bucketSpan` 으로 조회 + `summary.test.ts` 회귀
  - info 2 (min/max/last 반올림) · 3 (그룹핑 O(n²)) · 4 (`metrics=,`) · 5 (400 전 DB 조회) · 6 (range-params 테스트 · 주 버킷 롤업 · 연 경계 주) → 전부 반영. 테스트 42 → 52건
- Codex bot: PR 오픈 후
