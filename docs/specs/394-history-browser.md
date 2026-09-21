# [M15 #2] `/history` 브라우저 — 연 · 월 · 일간 종합 페이지

- **작성일**: 2026-09-21
- **타입**: feature
- **이슈**: #394 (추적 #392 · 마일스톤 스펙 `docs/specs/m15-overview.md` D1 · D2 · D3)
- **브랜치**: `feat/394-1`
- **의존**: #393 (v2.30.0 · `src/lib/history/`)

## 1. 배경

6년치 (2020-06 ~) 데이터를 사람이 볼 수 있는 UI 가 없다 — 기존 페이지는 전부 "최근 N일" 고정창이다 (m15-overview 인벤토리).
#393 이 집계 계층 (`getHistorySummary` · 지표 레지스트리 · KST 버킷 · `getHistoryLowerBound`) 을 만들었고, 이 이슈가 그 위에
**연 → 월 → 일** 드릴다운 UI 를 얹는다. 읽기 전용, 스키마 변경 없음, Garmin 호출 없음.

실코드 재검증 (2026-09-21):

| 지점 | 현황 |
|---|---|
| `src/lib/history/summary.ts` | `getHistorySummary(params, ctx, loader)` — 서버 컴포넌트 직접 호출용. 캐시 없음. `validateSummaryParams` 가 매 호출 `getHistoryLowerBound()` (findFirst 5회) |
| `src/lib/history/metrics.ts` | 11지표. activity `kind` 는 `"km" \| "count"` 뿐 — **평균 페이스 KPI 에 필요한 러닝 시간 합계가 없다**. `DailySummary.calorieBalance` · `estimatedIntakeCalories` 는 `NumericKey<DailySummary>` 라 등록 1건이면 된다 |
| `src/components/nutrition/NutritionDateNav.tsx` | 일 단위 전용 · `/nutrition?date=` 하드코딩 · 하한이 `MIN_HISTORY_YMD` 상수 (실제 최초 기록일 아님) · `shiftYmd` 가 `buckets.addDaysYmd` 와 중복 |
| `src/components/lifestyle/MonthlyHeatmap.tsx` | 이진값 (`activeDates: Set`) · **서버/브라우저 로컬 `new Date(year, month-1, 1)` · `new Date()` 로 오늘 판정** · 제목 "활동 캘린더" 하드코딩. 사용처 `lifestyle-client.tsx` 1곳 |
| `src/app/sleep/[date]/page.tsx` | 과거 날짜를 받는다 (일 뷰 수면 섹션의 위임 대상). 레코드 없으면 `notFound()` → **링크는 레코드가 있을 때만** 건다 |
| `src/app/api/body-composition/route.ts:58` | 수동 upsert. `SyncMetadata` 를 건드리지 않는다 (PR #401 Codex P2 의 근거 그대로). `parseLocalDate` 가 서버 로컬 — #365 영역이라 이 이슈에서 손대지 않는다 |
| 수동 쓰기 경로 전수 | `body-composition` (체중) · `food` · `food/[id]` (→ `DailySummary.estimatedIntakeCalories`/`calorieBalance` 재계산) · `activities/[id]` (routeTag 등 — 집계 지표 무관) · profile · training-plan (무관). **봇 프로세스 (`myfitness-bot`) 는 BodyComposition 을 쓰지 않는다** (`grep bodyComposition.upsert` = route + garmin fetcher 뿐). 봇의 식단 기록은 §4.6 참조 |
| PM2 | `myfitness` (Next) · `myfitness-bot` · `myfitness-mcp` **3 프로세스**. 모듈 레벨 캐시·버전 카운터는 Next 프로세스 안에서만 유효 |
| `Sidebar.tsx:214` | `isActive = pathname === item.href` (완전 일치) — `/history/2024/03` 에서 "기록" 이 활성 표시되지 않는다 |

## 2. 목표

1. `/history/YYYY` → `/history/YYYY/MM` → `/history/YYYY/MM/DD` 드릴다운과 레벨 공용 네비게이션.
2. 연·월 뷰의 셀 값은 **전부 `getHistorySummary` 경유** — 페이지가 각자 reduce 하지 않는다 (m15-overview D4).
3. 일 뷰 = 그날의 모든 데이터를 한 화면에 (8 섹션), 심층은 기존 상세 페이지로 위임.
4. summary 메모리 캐시로 6년 연 단위 웜 응답 1s 이내 → #393 F12 를 닫는다.

## 3. 요구사항

**라우트 · 네비**
- [ ] F1 라우트: `/history` → 오늘 KST 의 연도로 redirect. `/history/[year]` · `/history/[year]/[month]` · `/history/[year]/[month]/[day]`. 전부 `force-dynamic` 서버 컴포넌트
- [ ] F2 `src/lib/history/route-params.ts` (순수) — `parseHistoryRoute({ year, month?, day? }, { today, lowerBound })` → `{ level, ymd 범위 } | { redirectTo }`. 형식 오류·실존하지 않는 날짜 (2월 30일)·미래·하한 이전은 **같은 레벨의 가장 가까운 유효 값으로 redirect** (미래 → 오늘이 속한 연/월/일, 하한 이전 → 하한이 속한 연/월/일). 숫자가 아닌 세그먼트는 `/history` 로
- [ ] F3 `HistoryNav` (client) — 레벨 파라미터화: 이전/다음 · 점프 picker (연: 연도 탭 `lowerBound 연도 ~ 올해`, 월: `<input type="month">`, 일: `<input type="date">`, `min`/`max` = 하한/오늘) · 브레드크럼 `기록 › 2024 › 3월 › 15일` (상위 레벨 링크) · "오늘로". 이전/다음은 경계에서 disabled. `?metric=` 은 레벨 이동 시 유지
- [ ] F4 사이드바 "기록" (`/history`) 추가 — "리포트" 위. 활성 판정을 `pathname === href || pathname.startsWith(href + "/")` 로 (단 `/` 는 완전 일치 유지). 기존 항목 회귀 없음 (`/settings/profile` 등)

**연 뷰**
- [ ] F5 12개월 카드 그리드 (데스크톱 4×3 · 태블릿 3열 · 모바일 세로 스택). 카드 = 월 이름 + 선택 지표 월 값 + **미니 히트맵** (그 달 일별 값 색 강도) → 클릭 시 월 뷰. 미래 월·하한 이전 월은 비활성 표시
- [ ] F6 연 KPI 7종: 총 km · 러닝 횟수 · 평균 페이스 · 최고 VO2max · 평균 RHR · 평균 수면 점수 · 연말 체중 (`weight.last`). 평균 페이스 = 러닝 시간 합 / 러닝 km 합 (§4.2)
- [ ] F7 지표 선택기 `?metric=` (기본 `runningKm`). 미등록·비노출 id 는 기본값으로 fallback (400 아님 — 페이지 URL). 초기 노출 5개 + 추가 지표 (§4.2)

**월 뷰**
- [ ] F8 `MonthGrid` 신설 — 7열 (일~토, 기존 `MonthlyHeatmap` 과 같은 요일 순서), 셀 = 날짜 + 선택 지표 값. 러닝 km 는 숫자 + 색 강도, 나머지 지표는 숫자 (색 강도는 지표 def 의 `intensity` 플래그로 — 디자인 단계에서 확정). 셀 클릭 → 일 뷰. 오늘 링 표시, 미래·하한 이전 셀 비활성. **360px 에서 7열 유지**
- [ ] F9 월 KPI (연 KPI 와 같은 7종, 월 범위) + 일별 스트립 (선택 지표의 그 달 일별 막대/선 — Recharts, 포인트 클릭 → 일 뷰)
- [ ] F10 `MonthlyHeatmap` 은 **건드리지 않는다** (§4.4). lifestyle 회귀 0

**일 뷰 (일간 종합)**
- [ ] F11 `src/lib/history/day.ts` — `getHistoryDay(ymd)`: 8개 소스를 `Promise.all` 로 조회 (rawData 제외 select), 직렬화 가능한 DTO 반환. 범위는 전부 `kstDayRange(ymd)`
- [ ] F12 8 섹션 (순서 고정): ① 활동 목록 → `/activities/[id]` ② 수면 요약 (점수·총 수면·단계·HRV·최저 SpO2) → `/sleep/[date]` ③ 심박·스트레스·바디배터리 ④ 체중·체지방 ⑤ 혈압 ⑥ 걸음·칼로리 밸런스 ⑦ 식단 → `/nutrition?date=` ⑧ AI 리포트 (`AIAdvice.reportDate === ymd`, morning/evening)
- [ ] F13 데이터 없는 섹션은 **"기록 없음" 접힌 행**으로 표시 (숨기지 않는다). 결측과 0 을 구분 (걸음 0 ≠ 기록 없음)
- [ ] F14 상단: 전날/다음날 · 월 뷰로 올라가기 (HistoryNav 의 일 레벨)
- [ ] F15 SpO2 는 값만 표시 — **절대 임계 색·경고 금지** (memory `project_user_spo2_baseline`). 기존 `fmtSpO2` 재사용

**지표**
- [ ] F16 레지스트리 추가 3건: `runningDurationSec` (activity `kind: "duration"`, sum, missingAsZero, **선택기 비노출**) · `calorieBalance` (daily, avg) · `intakeKcal` (daily `estimatedIntakeCalories`, avg — **식단 캘린더 B-2 흡수**, §4.2). `HistoryMetricDef` 에 `selectable: boolean` 추가
- [ ] F17 지표 추가 = 레지스트리 1건 원칙 유지 — 선택기·그리드·KPI 포맷이 def (`label`/`unit`/`decimals`) 만 보고 렌더

**캐시**
- [ ] F18 `src/lib/history/cache.ts` — summary 메모리 캐시 (§4.5). 키 = 정규화 파라미터 + `max(SyncMetadata.lastSyncAt)` + `historyCacheVersion` + today. TTL 10분 · 최대 엔트리 수 제한. `getHistoryLowerBound` 도 같은 키 체계로 캐시
- [ ] F19 수동 쓰기 무효화: `bumpHistoryCacheVersion()` 을 `POST /api/body-composition` · `POST /api/food` · `PATCH|DELETE /api/food/[id]` 성공 경로에서 호출
- [ ] F20 회귀 테스트 (PR #401 Codex P2): 체중 수동 저장 (version bump) 직후 summary 가 새 값을 반환 / 같은 키 재호출은 loader 를 다시 부르지 않음 / TTL 경과 후 재조회 / lastSyncAt 변경 시 재조회
- [ ] F21 **프로덕션 재측정**: 6년 `granularity=year` 전 지표 웜 1s 이내 → `393-history-aggregation.md` F12 체크 · `docs/roadmap.md` M15-1 완료 표기. 배포 후 작업이라 PR 의 Test plan 에 남긴다

**공통**
- [ ] F22 한국어 UI · 다크 테마 · 모바일 반응형 · 수치 단위 규칙 (km 2자리 · bpm 정수 · kg 1자리 · 페이스 min:sec/km · kcal 정수)
- [ ] F23 신규 코드에서 `formatDateLocal` · `new Date(y, m, d)` (로컬 TZ) 금지. 날짜 산술은 `buckets.ts` 의 ymd 헬퍼만

## 4. 기술 설계

### 4.1 라우트 · 데이터 흐름

```
src/app/history/page.tsx                         redirect → /history/<올해 KST>
src/app/history/[year]/page.tsx                  연 뷰
src/app/history/[year]/[month]/page.tsx          월 뷰
src/app/history/[year]/[month]/[day]/page.tsx    일 뷰
```

- 각 page 는 `getCachedLowerBound()` → `parseHistoryRoute` → (redirect | 렌더). 연·월 뷰는 `getCachedHistorySummary` 를 **두 번** 호출한다:
  - 연 뷰: `granularity=month` (12 버킷 — 카드 값 + KPI 재료) + `granularity=day` (그 해 366 이하 — 미니 히트맵. #393 의 day 상한 366 안)
  - 월 뷰: `granularity=day` (그 달) 1회 + KPI 용 `granularity=month` 1회
  - 연 KPI 는 `granularity=year` 1회 (평균·최고·기간 말은 월 버킷에서 재집계하면 틀린다 — 평균의 평균 금지. 롤업을 연 단위로 한 번 더 돌린다)
- 지표 전환은 `?metric=` 서버 네비게이션 (`router.push`, `scroll: false`) — 선택 지표 1개 + KPI 고정 세트만 조회하므로 클라이언트 fetch 없이도 가볍다. `/api/history/summary` 는 #395 `/trends` 가 주 소비자.
- 미니 히트맵·MonthGrid 의 색 강도: 그 **뷰 범위 안의 최댓값 대비** 5단계 (연 뷰는 그 해 일별 최댓값). `missingAsZero` 지표의 0 은 빈 칸, 그 외 지표의 결측은 점선 테두리 "기록 없음" (디자인 단계 확정).

### 4.2 지표 (F16 · F17)

| id | 소스 | 집계 | 노출 | 비고 |
|---|---|---|---|---|
| `runningDurationSec` | Activity.duration (isRunningType) | sum · missingAsZero | 비노출 | 평균 페이스 KPI 전용. `loadActivity` select 에 `duration` 추가 (요청된 경우에만) |
| `calorieBalance` | DailySummary.calorieBalance | avg | 추가 지표 | 인계 문서의 "등록 1건" |
| `intakeKcal` | DailySummary.estimatedIntakeCalories | avg | 추가 지표 | **판단 보류 해소: 식단 캘린더 (M14 B-2) 를 흡수한다.** 등록 1건 비용이고 월 그리드가 곧 식단 캘린더다. FoodLog 는 2026~ 라 그 이전은 전부 "기록 없음" 으로 나오는 게 맞다 |

- 선택기 노출: **기본 5** (러닝 km · 걸음 · 수면 점수 · 안정시 심박 · 체중) + **추가** (러닝 횟수 · VO2max · 칼로리 밸런스 · 섭취 kcal). 나머지 등록 지표 (활성 칼로리 · HRV · 스트레스 · LT 페이스) 는 `selectable: true` 로 두되 추가 그룹 뒤에 — 최종 배치는 디자인 단계.
- 평균 페이스 = `runningDurationSec.value / runningKm.value` (km 0 이면 "기록 없음"). `formatPace` 재사용. 페이지 헬퍼 `src/lib/history/kpi.ts` (순수 · 테스트 대상) 에 둔다.
- 알려진 한계: `intakeKcal` 은 워치 미착용일에 DailySummary 행이 없어 누락된다 (#383 §3.3 수용 트레이드오프, 인계 문서 P3). 이 이슈에서 고치지 않는다 — §7.

### 4.3 네비 (F2 · F3)

- `parseHistoryRoute` 는 순수 함수 (today · lowerBound 주입) → vitest. redirect 규칙을 한 곳에 두어 연도 탭 · picker `min` · 라우트 검증이 같은 하한을 쓴다 (m15-overview D1).
- 월·일 세그먼트는 **2자리 zero-pad 정규형** (`/history/2024/3` → `/history/2024/03` redirect) — 링크 공유 시 URL 이 하나로 수렴.
- `HistoryNav` 는 `NutritionDateNav` 의 picker 패턴 (열기/취소/이동) 을 가져오되 `shiftYmd` 대신 `addDaysYmd` · 신설 `addMonthsYm` 을 쓴다. **`NutritionDateNav` 자체는 이번에 교체하지 않는다** — `/nutrition?date=` 쿼리 기반이라 경로 기반 HistoryNav 와 URL 빌더가 다르고, 교체는 회귀 위험만 있다. 중복 `shiftYmd` 제거는 후속 (§7).
- `buckets.ts` 가 prisma 를 import 하지 않으므로 client 컴포넌트에서 안전 (`index.ts` 주석의 규칙대로 개별 import).

### 4.4 MonthGrid 신설 (F8 · F10) — `MonthlyHeatmap` 일반화 대신

`MonthlyHeatmap` 은 로컬 TZ `Date` 로 달력을 만들고 브라우저 `new Date()` 로 오늘을 판정한다. 값·라벨 prop 으로 일반화하려면 내부를
ymd 기반으로 다시 써야 해서 사실상 신규 작성이고, 그러면서 lifestyle 의 렌더를 건드리게 된다. **`src/components/history/MonthGrid.tsx` 를 새로 만들고
`MonthlyHeatmap` 은 그대로 둔다.** 달력 셀 계산 (`monthCells(ym)` — 첫 요일 · 일수 · 윤년) 은 순수 함수로 `buckets.ts` 옆에 두고 테스트한다.
미니 히트맵 (연 뷰 카드) 도 같은 `monthCells` 를 쓴다. lifestyle 을 MonthGrid 로 옮기는 것은 후속 후보.

### 4.5 캐시 (F18 ~ F20)

```ts
// src/lib/history/cache.ts (서버 전용)
let historyCacheVersion = 0;
export function bumpHistoryCacheVersion(): void
export async function getCachedLowerBound(): Promise<string>
export async function getCachedHistorySummary(params, ctx): Promise<HistorySummary>
```

- **키** = `JSON.stringify([granularity, from, to, [...metrics].sort()])` + `|` + syncStamp + `|` + version + `|` + today.
  - `syncStamp` = `prisma.syncMetadata.aggregate({ _max: { lastSyncAt: true } })` — 요청당 1쿼리 (수 ms). 싱크가 **어느 프로세스에서 돌든** DB 값이라 Next 프로세스가 본다. 싱크는 행을 쓴 뒤 `lastSyncAt` 을 갱신하므로, 그 사이 요청이 옛 stamp 로 캐시해도 stamp 가 바뀌면 키가 달라져 자연 폐기.
  - `today` 를 키에 넣는 이유: 자정을 넘기면 `totalDays`·버킷 목록이 달라진다.
  - `version` 은 **Next 프로세스 모듈 변수**. 수동 쓰기 route 가 전부 같은 프로세스라 성립한다 (§1 표).
- **저장 단위**: 완성된 `HistorySummary` (불변 취급 — 호출자는 변형 금지, 테스트로 고정). 동시 요청 중복 조회 방지를 위해 **Promise 를 캐시**하고 reject 시 즉시 제거.
- **만료**: TTL 10분 + 최대 64 엔트리 (초과 시 가장 오래된 것부터 제거). 키에 stamp·version 이 들어가므로 옛 엔트리는 다시 조회되지 않고 TTL/용량으로만 빠진다 — 메모리 상한은 64 × 수십 KB.
- **`getCachedLowerBound`**: 같은 stamp·version 키. 하한은 과거 backfill 또는 가장 오래된 체중 수동 입력으로만 바뀐다.
- `/api/history/summary` route 도 캐시 경유로 바꾼다 (F12 측정 대상이 이 엔드포인트).
- 테스트는 loader·stamp 조회·clock 을 주입 가능한 팩토리 (`createHistoryCache({ loader, getSyncStamp, now })`) 로 — prisma mock 없이 순수하게.
- dev (HMR) 에서 모듈 재평가로 캐시가 비는 것은 무해.

### 4.6 수동 쓰기 무효화 범위 (F19)

| 경로 | 프로세스 | 영향 지표 | 처리 |
|---|---|---|---|
| `POST /api/body-composition` | Next | weight | bump |
| `POST /api/food` · `PATCH/DELETE /api/food/[id]` | Next | intakeKcal · calorieBalance | bump |
| 텔레그램 봇 식단 기록 | **bot (별도 프로세스)** | intakeKcal · calorieBalance | **bump 불가** → 최대 TTL 10분 지연을 수용. 봇으로 기록하고 10분 안에 웹 `/history` 의 섭취 kcal 을 보는 경로는 드물고, 일 뷰 식단 섹션은 캐시를 안 거친다 (F11 직접 조회). 실코드 확인 (2026-09-21): 봇은 `src/bot/commands/food*.ts` 에서 `foodLog` 를 직접 쓰고, `syncMetadata` 를 쓰는 곳은 `src/lib/garmin/sync.ts` 뿐 → stamp 로도 잡히지 않는다 |
| Garmin 싱크 (cron · 수동 · backfill) | Next / 스크립트 | 전부 | `lastSyncAt` stamp |

일 뷰 (`getHistoryDay`) 는 **캐시하지 않는다** — 단일 날짜 8쿼리는 가볍고, 방금 기록한 식단·체중이 바로 보여야 한다.

### 4.7 일 뷰 DTO (F11)

| 섹션 | 조회 | 비고 |
|---|---|---|
| 활동 | `activity.findMany({ startTime ∈ day })` — id · name · activityType · startTime · duration · distance · avgPace · avgHR · calories | 러닝 우선 정렬 아님, 시간순. 러닝은 페이스, 그 외는 시간 중심 표기 |
| 수면 | `sleepRecord.findUnique({ date })` — 점수 · 총/단계 · HRV · 최저 SpO2 · 취침/기상 | 수면 `date` 의미 (기상일 기준) 는 기존 `/sleep` 과 동일하게 — 착수 시 fetcher 확인 |
| 심박 등 | `dailySummary` (restingHR · avgStress · bodyBattery High/Low) + `heartRateRecord` (min/max/avg HR) | |
| 체성분 | `bodyComposition.findUnique({ date })` — weight · bodyFat · muscleMass · source | **주의**: 수동 입력은 `parseLocalDate` (서버 로컬 자정) 로 저장된다. 서버가 KST 라 `kstInstant(ymd)` 와 일치하지만 범위 조회 (`gte/lt kstDayRange`) 로 방어 |
| 혈압 | `bloodPressure` — 수축/이완 최고·최저 · 맥박 · 측정 횟수 | |
| 걸음·칼로리 | `dailySummary` — steps · totalCalories · activeCalories · estimatedIntake · calorieBalance | |
| 식단 | `foodLog.findMany({ date ∈ day })` — description · estimatedKcal · mealType · 매크로 | items 분해는 링크 위임 |
| AI 리포트 | `aIAdvice.findMany({ reportDate: ymd, category in [morning_report, evening_report] })` — response 앞부분 + 펼치기 | 마크다운 렌더는 `/reports` 의 기존 컴포넌트 재사용 (착수 시 확인) |

`Date` 는 전부 ISO 문자열로 직렬화해 client 섹션 컴포넌트에 넘긴다.

## 5. 변경 파일

```
신설
  src/app/history/page.tsx · [year]/page.tsx · [year]/[month]/page.tsx · [year]/[month]/[day]/page.tsx
  src/components/history/HistoryNav.tsx · MetricPicker.tsx · YearMonthCard.tsx · MonthGrid.tsx
                         · KpiRow.tsx · DayStrip.tsx · DaySection.tsx (+ 섹션별 본문 컴포넌트)
  src/lib/history/route-params.ts · month-cells.ts · kpi.ts · day.ts · cache.ts
  src/lib/history/__tests__/route-params.test.ts · month-cells.test.ts · kpi.test.ts · cache.test.ts
  docs/designs/394-history/ (prototype.jsx · design-notes.md)
수정
  src/lib/history/metrics.ts (지표 3건 · selectable) · load.ts (duration) · index.ts · __tests__/metrics.test.ts
  src/app/api/history/summary/route.ts (캐시 경유)
  src/app/api/body-composition/route.ts · api/food/route.ts · api/food/[id]/route.ts (bump)
  src/components/layout/Sidebar.tsx ("기록" · 활성 판정)
  docs/specs/393-history-aggregation.md (F12 — 배포 후 재측정 시) · docs/roadmap.md
DB 마이그레이션: 없음. 패키지 추가: 없음.
```

파일당 400줄 이내 · 컴포넌트는 default export.

구현 순서: 디자인 시안 승인 → F16 (지표) → F18~F20 (캐시, 테스트 먼저) → F2 (route-params, 테스트 먼저) · month-cells · kpi → F11 (day) → F3 · F4 → 연 뷰 → 월 뷰 → 일 뷰 → 4종 검증 → 사전 에이전트 리뷰.

## 6. 테스트 계획

vitest (`src/lib/history/__tests__/`):
- **cache** (F20): 같은 키 2회 → loader 1회 · version bump 후 재조회로 새 값 (PR #401 Codex P2 회귀) · syncStamp 변경 시 재조회 · TTL 경과 재조회 · today 변경 시 재조회 · metrics 순서 무관 동일 키 · loader reject 는 캐시에 남지 않음 · 64 엔트리 초과 제거 · 동시 호출 1회 조회
- **route-params**: 정상 3레벨 · zero-pad 정규화 · 2월 30일 · 미래 연/월/일 → 오늘 쪽 · 하한 이전 → 하한 쪽 · 하한이 속한 달의 하한 이전 날짜 · 비숫자 세그먼트
- **month-cells**: 2024-02 = 29일 · 첫 요일 오프셋 · 12월 → 다음 해 경계 · `addMonthsYm`
- **kpi**: 평균 페이스 (시간 합/거리 합 — 평균의 평균 아님) · km 0 → null · 결측 KPI null
- **metrics**: 기존 유일성·타입 테스트에 신규 3건 포함 · `selectable: false` 는 선택기 목록에서 빠짐

수동 (로컬 · 스텁 DB):
- 3 레벨 렌더 · 지표 전환 · 브레드크럼/이전/다음/picker · 경계 disabled · 잘못된 URL redirect
- 360px 폭에서 월 그리드 7열 · 연 뷰 세로 스택
- 일 뷰: 데이터 없는 날 8 섹션 전부 "기록 없음" · 수면 없는 날 `/sleep/[date]` 링크 미노출
- `/lifestyle` 회귀 없음 (MonthlyHeatmap 무변경 확인)
- 체중 수동 저장 → `/history` 월 뷰 체중 셀 즉시 반영

배포 후: F21 재측정 (`curl -w '%{time_total}'` 웜 3회) · 실데이터로 2020-06 첫 달 (하한 경계) · 2024-02 (윤년) 확인.

## 7. 제외 사항

- `/trends` (#395) · 개인 기록/이벤트 마커/커버리지 띠 (#396) · 심화 시각화 (#397). **차트 포인트 → 일 뷰 링크는 이 이슈의 월 뷰 스트립·그리드 셀까지만**, `/trends` 쪽은 #396.
- `NutritionDateNav` 를 `HistoryNav` 로 교체 · `shiftYmd` 중복 제거 · lifestyle 을 `MonthGrid` 로 이전 — 회귀 위험 대비 이득이 없어 후속 후보 (#392 에 메모).
- `body-composition` route 의 `parseLocalDate` (서버 로컬) — #365.
- 워치 미착용일 `intakeKcal` 누락 (FoodLog 경로에서 DailySummary 행 생성) — 인계 문서 P3 미생성 항목.
- 봇 프로세스 식단 기록의 즉시 캐시 무효화 (프로세스 간 신호) — TTL 10분 수용 (§4.6).
- 편집 기능 — 전부 읽기 전용. DB 집계 (raw query) · materialized rollup — 금지/불필요.

## 8. 코드 리뷰 결과

- 사전 에이전트 리뷰 1회 (2026-09-21): critical 0 · major 2 · info 4 → 전부 반영
  - major 1: `HistoryNav` month/date 입력이 controlled 라 `type="month"` 텍스트 폴백 브라우저 (데스크톱 Safari/Firefox) 에서 타이핑 불가 → uncontrolled (`defaultValue` + `key`). UI 상호작용이라 회귀 테스트 대신 이 문구로 고정 (8-5 예외)
  - major 2: `DayStrip` 바닥값 `min * 0.97` 이 음수 (`calorieBalance`) 에서 최솟값 위로 올라가 막대 평탄화 → `strip-scale.ts` 로 추출, 범위 기준 오프셋. 회귀 `__tests__/strip-scale.test.ts`
  - info 1: 캐시 키에 `lowerBound` 추가 · `clampedFrom/To` 는 키에서 빼고 호출자 값으로 덮어써 페이지·API 가 엔트리 공유
  - info 2: cron 의 kcal backfill · stale recalc 는 `lastSyncAt` 갱신 **뒤** 에 쓴다 → cron `finally` 에서 버전 bump
  - info 3: sync stamp 5초 재사용 (웜 연 뷰 렌더의 DB 왕복 4 → 1)
  - info 4: 하한이 걸친 달의 커버리지 분모에서 하한 이전 일수 제외
- Codex bot 1회차 (PR #402, 2026-09-21): P0/P1 0 · P2 1 → 반영. `PATCH /api/profile` 의 `recalculateAllCalorieBalances()` 는 백그라운드라 응답 시점 bump 가 재계산 **중간** 값을 새 버전으로 캐시 → 정착 시점 (`.finally`) bump 로 이동
- Codex bot 2회차 (자동 재리뷰): P0/P1 0 · P2 1 → 반영. 거리 없는 (0 · null) 러닝의 `duration` 이 평균 페이스 분자에만 들어가 KPI 가 느려짐 → 거리 있는 러닝만 합산 (`activityPoints` 순수 함수로 추출). 회귀 `__tests__/load-activity.test.ts`
- Codex bot 3회차 (자동 재리뷰): P0/P1 0 · P2 2 → 반영. (1) daily-summary fetcher 의 백그라운드 `recalculateAllCalorieBalances()` 도 1회차와 같은 부분 재계산 캐시 문제 → bump 를 **함수 자체의 완료 시점** 으로 옮겨 모든 호출자를 한 곳에서 덮음 (프로필 route 의 `.finally` 제거) (2) 선택 가능해진 `ltPace` 가 `321 sec/km` 로 표시 → 레지스트리 `format: "pace"` + `historyDisplayUnit`, 회귀 `kpi.test.ts`
- **종료 판단**: P2 만 3라운드 연속 (memory `project_codex_auto_rereview`). 이후 자동 재리뷰가 P2 이하만 내면 후속 이슈로 트래킹하고 이 PR 에서는 반영하지 않는다

## 9. 시안 · 스펙 대비 구현 차이

- 일별 스트립 (F9): Recharts 대신 서버 렌더 링크 막대 — 그리드가 값을 이미 보여 주고, 막대가 곧 일 뷰 링크다 (클라이언트 JS 없음).
- 평균 페이스 표기는 앱 기존 `formatPace` (`5'46"`) — 시안의 `5:46` 아님.
- 셀 축약: 1만 이상만 `17.8k`, 그 미만은 `7,712`.
- 무효화 대상에 `PATCH /api/profile` (targetCalories → 전체 칼로리 밸런스 재계산) 과 cron 후속 쓰기 추가 (F19 는 체중·식단만 적었다).
