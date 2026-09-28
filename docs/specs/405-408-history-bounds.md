# [후속 #405 · #408] 히스토리 하한 경계 — 하한 > 오늘 방어 · 첫 버킷 커버리지 분모 · 하한 이전 데이터 유입 방어

- **작성일**: 2026-09-28
- **타입**: fix (bug · P2 ×2)
- **이슈**: #405 (릴리즈 PR #404 Codex P2) · #408 (PR #407 Codex 4회차 P2 ×2)
- **브랜치**: `fix/405-1` (dev → dev) — 두 이슈가 같은 입구 (`resolve` · `validateSummaryParams` · ctx) 를 건드려 함께
- **의존**: #393 (하한 · 버킷) · #394 (`/history` 라우트) · #395 (`/trends`)

## 1. 배경 (2026-09-28 실코드 재검증 — 셋 다 유효 · 프로덕션에는 드러나지 않음)

**#405 하한 > 오늘**: `getHistoryLowerBound()` 는 5개 모델 최초 기록일의 최소값. 기록이 하나도 없는 설치에서 `POST /api/body-composition` 으로 미래 체중을 저장하면 하한이 오늘보다 미래 → `HistoryNav` 연도 탭 길이 0 이하 · `parseHistoryRoute` 의 `clamp(min > max)` 가 redirect 왕복 가능 · `parseSummaryParams` 는 `from > to` 400. 프로덕션은 2020-06 부터 기록이 있어 도달 불가.

**#408-1 첫 버킷 커버리지 분모**: `/trends` 의 `toTrendPoints` · `pivotByYear` 가 `bucket.totalDays` (달력 전체) 를 분모로 쓴다. 하한이 버킷 중간이면 기록 시작 전 날까지 세어 저커버리지로 오분류 (1/20~31 매일 기록 → 12/31). `/history` 연 뷰는 이미 `coverableDays` (`view.ts`) 로 고쳤다. 프로덕션 하한 2020-06-16 → 15/30 = 0.5 로 경계 통과 (드러나지 않음).

**#408-2 하한 이전 데이터 유입**: `getHistorySummary` 가 버킷 스팬 (첫 주 버킷은 하한 이전 월요일부터) 으로 `loadDailyPoints` 를 부른다. 하한 앞에 행이 남아 있는 DB (2020-01-01 이전) 에서만 차트에 들어온다. `range-totals` 의 입력은 `trends-params` 가 이미 하한 · 오늘로 클램프한다.

## 2. 목표

1. 하한 > 오늘이어도 `/history` 는 올해 연 뷰를 렌더하고 redirect 가 1회로 수렴, summary 는 400 이 아니라 오늘 하루로 클램프.
2. `/trends` 첫 버킷 커버리지 분모 = 버킷 ∩ [하한, 오늘] 일수 (`/history` 와 같은 헬퍼).
3. summary 조회 범위 = 버킷 스팬 ∩ [하한, 오늘] — 하한 이전 · 오늘 이후 행은 읽지 않는다.
4. `POST /api/body-composition` 은 미래 날짜를 거부 (하한이 미래가 되는 입구를 막는다).

## 3. 요구사항

- [x] F1 `src/lib/history/bounds.ts` (순수): `effectiveLowerBound(lowerBound, today)` = min · `coverableDays(bucket, lowerBound)` (view.ts 에서 이동) · `clipSpan(span, ctx)` (∩ [하한, 오늘] · 비면 null).
- [x] F2 `lower-bound.ts` `clampLowerBound(earliest, todayYmd?)` — 하한 > 오늘이면 오늘. `getHistoryLowerBound` 가 `todayKSTString()` 전달 (원천 정규화).
- [x] F3 입구 정규화 (순수 함수 안에서 · 캐시된 옛 하한도 방어): `parseHistoryRoute` · `parseSummaryParams` · `resolveTrendsRange` · `monthRangeToYmd` · `clampYm` 가 `effectiveLowerBound` 를 쓴다. `HistoryNav` 연도 배열 길이 `Math.max(1, …)`.
- [x] F4 `trends.ts` `toTrendPoints` · `pivotByYear`: `totalDays` · `lowCoverage` 분모를 `coverableDays(bucket, ctx.lowerBound)` 로. `view.ts` 는 공용 헬퍼 사용.
- [x] F5 `summary.ts` `getHistorySummary`: `clipSpan(bucketSpan(buckets), ctx)` 로 loader 호출 (null 이면 조회 없음).
- [x] F6 `POST /api/body-composition`: `date > todayKSTString()` → 400 `미래 날짜는 기록할 수 없습니다`.
- [x] F7 회귀 테스트: `bounds.test.ts` · `route-params.test.ts` (하한 > 오늘 · redirect 재파싱 ok) · `summary-params.test.ts` (하한 > 오늘 → 오늘로 클램프) · `trends.test.ts` (1/20~31 매일 기록 → lowCoverage false · partial clipped · totalDays 12) · `summary.test.ts` (loader 가 클립된 범위로 호출) · `lower-bound` 의 `clampLowerBound(…, today)`.
- [x] F8 로드맵 M15-2 · M15-3 후속 표기.

## 4. 기술 설계

- `bounds.ts` 는 prisma 를 import 하지 않는다 — `route-params.ts` 가 클라이언트 번들에 들어가므로 (`lower-bound.ts` 는 prisma 의존).
- 원천 (`getHistoryLowerBound`) 과 입구 (순수 파서) 양쪽에서 정규화: 캐시에 남은 미래 하한 (TTL 안) 도 입구가 막는다.
- `coverableDays` 는 오늘 이후를 다시 빼지 않는다 — `enumerateBuckets` 의 `totalDays` 가 이미 오늘 이후를 세지 않는다.
- `range-totals` 는 변경 없음: 호출자 (`resolveTrendsRange` · `monthRangeToYmd`) 가 클램프한 범위를 넘기고 `rangeTotalsFromPoints` 가 범위 밖 포인트를 버린다. F3 로 그 클램프의 하한도 정규화된다.
- 미래 체중 거부는 이슈의 "별개로 판단" 항목 — 체중은 측정값이라 미래 기록의 정당한 쓰임이 없다. `targetDate` (프로필 목표일) 는 미래가 정상이라 무관.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/history/bounds.ts` (+ `__tests__/bounds.test.ts`) | 신규 · 순수 |
| `src/lib/history/lower-bound.ts` (+ `__tests__/lower-bound.test.ts`) | `todayYmd` 클램프 |
| `src/lib/history/route-params.ts` · `summary-params.ts` · `trends-params.ts` | 입구 정규화 |
| `src/lib/history/trends.ts` · `view.ts` · `summary.ts` | 분모 · 클립 |
| `src/components/history/HistoryNav.tsx` | 길이 방어 |
| `src/app/api/body-composition/route.ts` | 미래 거부 |
| 테스트 5개 갱신 · `docs/roadmap.md` | — |

## 6. 테스트 계획

§3 F7 + 4종 검증. 프로덕션은 도달 불가 경로라 배포 후 확인은 `/history` · `/trends` 가 그대로인지 (회귀 없음) 만.

## 7. 제외 사항

- `range-totals` 시그니처 변경 (ctx 주입) — 호출자 클램프로 충분.
- 캐시 키에 오늘을 넣는 문제 (자정 넘김) — 기존 설계 (`getCachedLowerBound` TTL) 그대로.
