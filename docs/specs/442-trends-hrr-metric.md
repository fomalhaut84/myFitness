# [M17 #3] `/trends` 에 HRR 추이 지표 추가

- **작성일**: 2026-09-23
- **타입**: feature
- **이슈**: #442 (P2)
- **브랜치**: `feat/442-1`
- **의존**: #425 (`Activity.hrr2` 승격 · `median`) · #395 (`/trends` 뷰 5개 · 지표 레지스트리). 스키마 변경 없음 · 패키지 추가 없음.

## 1. 배경

HRR 추이는 `/insights` 패널 E (연도별 산점도 + 중앙값) 에만 있다. `/trends` 는 `src/lib/history/metrics.ts` 레지스트리의 지표 14개를 시계열 · 전년 동기 · 계절성 · 기간 비교 · 개인 기록으로 보여주는데, HRR 이 빠져 있다. `Activity.hrr2` 는 승격된 컬럼이라 지표 1건 추가 비용이 낮다.

실코드 재검증 (2026-09-23):

| 지점 | 현황 |
|---|---|
| `HistoryAggregate` | `"sum" \| "avg" \| "max" \| "last"` — **중앙값 없음**. `rollup.ts` `aggregateValue` 의 switch 1곳이 계산 본체 (`range-totals` 도 공유) |
| activity 소스 | `{ source: "activity"; kind: "km" \| "count" \| "duration" }` · `activityPoints(rows, defs)` 순수 · `loadActivity` select 에 `hrr2` 없음 |
| aggregate 로 분기하는 곳 | `trends/page.tsx` `WHOLE_LABELS` · `SEASON_CAPTIONS` (객체 인덱스 — 키 없으면 `undefined` 문구) · `chart-format.ts` `aggregateCaption` · `trends.ts` `seasonality` (avg 는 기록 일수 가중, 그 외 mean) · `showBand = avg && withMinMax` |
| `median` | `src/lib/insights/stats.ts` (prisma 없음 · 순수) — history 에서 import 가능 |
| 시작일 캡션 | `/insights` 는 `hrrFrom` 을 데이터에서 계산해 `how` 에 붙인다. `/trends` 에는 지표별 시작일 캡션 개념이 없다 (`Keys` 목록에 문구 추가 가능) |
| 개인 기록 | `records.ts` `PersonalRecords` — `bestVo2max` · `lowestRestingHR` 이 `DatedValue` 패턴. `RecordsPanel.buildRecordRows` 가 행 8개 고정 |
| `sparse` | 체중 · 젖산역치 페이스가 사용 — 커버리지 흐림 · 제외 규칙 면제. 프로덕션 hrr2 는 2026-04-22 ~ (111건) 라 같은 처리가 맞다 |

## 2. 목표

1. `/trends` 지표 선택기에 **2분 HRR** 이 생기고 5개 뷰 전부에서 동작한다 (주/월/연 버킷 = **중앙값**).
2. 데이터 시작일이 캡션에 보인다 ("종료 후 심박은 2026-04 부터 있습니다") — 패널 E 규칙 재사용.
3. 개인 기록에 **가장 큰 2분 HRR** 1행.

## 3. 요구사항

**레지스트리 · 집계**
- [ ] F1 `HistoryAggregate` 에 `"median"` 추가. `rollup.ts` `aggregateValue` 에 `case "median"` (`median` 재사용 · 빈 배열 null · 짝수 개 .5 → `decimals` 반올림)
- [ ] F2 activity 소스 `kind: "hrr2"` 추가. `ActivityRow.hrr2` · `loadActivity` select 에 `hrr2` · `activityPoints`: 러닝 계열 · `hrr2 !== null` 인 활동만 `{ ymd, value: hrr2 }` (한 날 두 러닝이면 점 2개 — 버킷 중앙값에 둘 다 들어간다)
- [ ] F3 지표 정의: `{ id: "hrr2", label: "2분 HRR", unit: "bpm", decimals: 0, source: "activity", kind: "hrr2", aggregate: "median", sparse: true, withMinMax: true }` — 띠 (최저~최고) 로 버킷 안 퍼짐을 보인다 (인터벌 · 레이스가 큰 값). `selectable: true` 라 `/history` 선택기 "추가" 그룹에도 나온다
- [ ] F4 aggregate 분기 보강: `WHOLE_LABELS.median = "중앙값"` · `SEASON_CAPTIONS.median = "굵은 선 = 그 달의 중앙값들의 평균"` · `aggregateCaption`: `"선 = 기간 중앙값, 띠 = 최저~최고"` · `showBand` 를 `(avg || median) && withMinMax` · `seasonality` 는 mean 그대로 (중앙값들의 평균 — 캡션이 말한다). 객체 인덱스 둘은 `Record<HistoryAggregate, string>` 으로 타입을 조여 **키 누락이 컴파일 에러**가 되게 한다

**캡션 · 개인 기록**
- [ ] F5 데이터 시작일: `src/lib/history/data-start.ts` — `loadMetricDataStart(def)`: `kind === "hrr2"` 면 `activity.findFirst({ where: 러닝 AND hrr2 not null, orderBy startTime asc })` 의 KST `YYYY-MM`, 그 외 null. `/trends` 시계열 · 전년 동기 · 계절성 뷰의 `Keys` 에 `종료 후 심박은 ${from} 부터 있습니다` 추가 (null 이면 생략). 문구는 `metrics.ts` 의 `startNote?: string` (`{from}` 치환) 로 정의 — 다른 sparse 지표에도 열어 둔다
- [ ] F6 개인 기록: `PersonalRecords.bestHrr2: DatedValue | null` — 러닝 · 하한~오늘 · `hrr2` 최대 · 동률이면 먼저 달성한 날 (`orderBy [{ hrr2: desc }, { startTime: asc }]`). `RecordsPanel` 행 "가장 큰 2분 HRR" (값 bpm · 부제 "처음 도달한 날" · 날짜 → `historyDayPath` + `historyMetricQuery("hrr2")`). 빈 상태 "종료 후 심박이 계산된 러닝이 없습니다"
- [ ] F7 `hrrDrop10` 은 지표로 두지 않는다 (이슈 기본안). 필요 시 `kind: "hrrDrop10"` 1줄 추가로 열린다

**테스트 · 문서**
- [ ] F8 vitest — §6
- [ ] F9 `docs/roadmap.md` M17-3 · `docs/specs/M14-followup.md`

## 4. 기술 설계

```
metrics.ts     HISTORY_METRIC_IDS += "hrr2" · HistoryAggregate += "median" · activity kind += "hrr2" · startNote
load.ts        ActivityRow.hrr2 · activityPoints kind "hrr2" · loadActivity select hrr2
rollup.ts      aggregateValue case "median"  (insights/stats median)
data-start.ts  loadMetricDataStart(def)  (prisma)          ← trends/page.tsx Keys
records.ts     bestHrr2                                      ← RecordsPanel 행 추가
trends/page.tsx · chart-format.ts   median 문구 · showBand
```

**중앙값 vs 평균** — 패널 E 와 같은 이유 (인터벌 · 레이스처럼 고심박에서 멈춘 러닝이 평균을 끌어올린다). 기간 비교 뷰 (`compare.ts`) 는 `aggregatePoints` 를 그대로 쓰므로 한 덩어리 중앙값이 된다 — 별도 코드 없음.

**`sparse` 의 효과** — 주 버킷에 러닝 2~3건뿐이라도 "기록 절반 미만" 흐림을 적용하지 않는다. 대신 `withMinMax` 띠가 표본 퍼짐을 보인다.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/history/metrics.ts` · `load.ts` · `rollup.ts` · `records.ts` | 지표 · 집계 · 기록 |
| `src/lib/history/data-start.ts` (+ 테스트 — 순수 부분 `ymToNote`) | 신규 |
| `src/app/trends/page.tsx` · `src/components/trends/chart-format.ts` · `RecordsPanel.tsx` | 문구 · 띠 · 행 |
| `src/lib/history/__tests__/*.test.ts` · `src/components/trends/__tests__/*` | 회귀 |
| `docs/specs/442-trends-hrr-metric.md` · `docs/roadmap.md` · `docs/specs/M14-followup.md` | 문서 |

## 6. 테스트 계획

- `rollup.test.ts`: median 홀수 · 짝수 (.5 → decimals 0 반올림) · 빈 버킷 null (0 아님) · `withMinMax` 띠 값
- `load.test.ts` (`activityPoints`): `hrr2` null 활동 제외 · 러닝 외 제외 · 같은 날 두 러닝 → 점 2개 · 음수 HRR 은 그대로 (걸러내지 않음)
- `metrics.test.ts`: `hrr2` 등록 · `isHistoryMetricId("hrr2")` · `selectable`
- `records.test.ts`: `bestHrr2` 동률 → 먼저 달성한 날 (`firstExtreme` 재사용 시)
- `RecordsPanel.buildRecordRows`: 행 9개 · 빈 상태 문구
- `chart-format.test.ts`: `aggregateCaption` median
- 로컬 `next dev`: `/trends?metric=hrr2` 5개 뷰 (러닝 5건 · 2026-04) · `/history` 선택기

## 7. 제외 사항

- 패널 E 변경 — `/insights` 는 그대로
- `hrrDrop10` 지표 (F7)
- 강도별 (이지 · 인터벌) 분리 — `/insights` 후속과 함께
