# [M17 #4] 월별 그리드 시작 요일 일 → 월

- **작성일**: 2026-09-24
- **타입**: chore (UI 규칙 통일)
- **이슈**: #445 (P2)
- **브랜치**: `fix/445-1`
- **의존**: #394 (`month-cells.ts` · `MonthGrid`) · #396 (`YearMonthCard`). 스키마 변경 없음 · 패키지 추가 없음.
- **사용자 요청 (2026-09-23)**: `일 월 화 수 목 금 토` → **`월 화 수 목 금 토 일`**.

## 1. 배경

`/history` 월 그리드 · 연간 월 카드 · `/lifestyle` 월별 활동 캘린더가 일요일 시작이다. 주간 버킷 (`buckets.ts` — 주 키 = 월요일) · `startOfWeekKST` · 트레이닝 플랜 캘린더 (`DAY_HEADERS_BASE = MON…SUN`) 는 이미 월요일이라 화면마다 주의 시작이 다르다.

실코드 재검증 (2026-09-24):

| 파일 | 현황 | 대상 |
|---|---|---|
| `src/lib/history/month-cells.ts` | `dayOfWeekYmd` = `getUTCDay` (0 = 일). `monthCells().leadingBlanks` = 1일의 요일 → **일요일 시작 그리드** 의 앞 빈 칸. `view.ts` 두 곳이 그대로 소비 | ✅ 여기가 정본 — 1곳 바꾸면 `/history` 월 · 연간 둘 다 |
| `src/components/history/MonthGrid.tsx` · `YearMonthCard.tsx` | `DAY_LABELS = ["일", …]` (MonthGrid) · `leadingBlanks` 로 빈 칸 | ✅ 헤더 순서 |
| `src/components/lifestyle/MonthlyHeatmap.tsx` | **자체 계산** — 로컬 TZ `new Date(y, m-1, 1).getDay()` (#365 가 지적한 서버 로컬 TZ 의존) · `DAY_LABELS = ["일", …]` | ✅ `monthCells` 로 갈아타면 요일 · TZ 둘 다 해결 |
| `src/components/dashboard/WeeklyChart.tsx` | **최근 7일 롤링** (`weekAgo ~ today`, `src/app/page.tsx`) — 날짜순이라 시작 요일 개념이 없다. `DAYS[getDay()]` 는 라벨만 | ❌ 대상 아님 (이슈 본문 정정) |
| `HistoryNav` · `NutritionDateNav` · `ProteinTrend` · `dashboard-client` · `system-prompt` | 요일 **라벨**만 (`getDay()` 인덱스) | ❌ 대상 아님 |
| `PlanCalendar.tsx` | `DAY_HEADERS_BASE = MON…SUN` + 플랜 시작일 회전 | ❌ 이미 월요일 |

## 2. 목표

1. 월 그리드 3곳 (`/history` 월 · 연간 카드 · `/lifestyle` 히트맵) 이 **월요일 시작** 으로 통일된다.
2. 요일 순서 · 앞 빈 칸 계산이 **`month-cells.ts` 한 곳** 에 있고, 컴포넌트는 그 상수 · 결과만 쓴다.
3. `MonthlyHeatmap` 의 로컬 TZ 달력 계산이 사라진다 (#365 잔여 1건 해소).

## 3. 요구사항

> **구현 (fix/445-1, 2026-09-24).** vitest 288 → 290 · 로컬 `next dev` 3화면 (`/history/2026/09` · `/history/2026` · `/lifestyle`) 캡처 `docs/designs/445-monday-start-grids/screenshots/`. 달라진 항목은 ↳.

**순수 로직 (`src/lib/history/month-cells.ts`)**
- [x] F1 `WEEKDAY_LABELS` 상수 `["월", "화", "수", "목", "금", "토", "일"]` export (client 안전 — prisma 없음).
- [x] F2 `weekdayIndexMon(ymd)` — 0 = 월 … 6 = 일 (`(getUTCDay() + 6) % 7`). 기존 `dayOfWeekYmd` (0 = 일) 는 **제거**.
  - ↳ 호출처가 하나 더 있었다 — `HistoryNav` 의 요일 라벨 (`DAY_NAMES[dayOfWeekYmd()]`). `WEEKDAY_LABELS[weekdayIndexMon()]` 로 교체 (표시 결과 동일)
- [x] F3 `monthCells().leadingBlanks` = `weekdayIndexMon(1일)`. 주석 "월요일 시작 그리드" 로. `view.ts` 는 변경 없음 (값만 바뀐다).

**컴포넌트**
- [x] F4 `MonthGrid` — `DAY_LABELS` 삭제 → `WEEKDAY_LABELS` import. 빈 칸 · 셀 렌더는 그대로.
- [x] F5 `YearMonthCard` — 미니 달력 `leadingBlanks` 그대로 (정본이 바뀌므로 자동). 헤더 없음 → 변경 없음 (확인만).
- [x] F6 `MonthlyHeatmap` — 자체 `new Date(...)` 계산을 `monthCells(formatYm(year, month))` 로 교체 (`leadingBlanks` + `days` ymd 배열 → 셀). `DAY_LABELS` → `WEEKDAY_LABELS`. `todayStr` 도 로컬 TZ 이므로 `todayKSTString()` 으로 (같은 파일 안 잔여 정리 · #365).
- [x] F7 주말 강조는 현재 어느 그리드에도 없다 — 새로 넣지 않는다 (범위 밖).

**테스트 · 문서**
- [x] F8 `month-cells.test.ts`: `weekdayIndexMon` (월 0 · 일 6) · `monthCells("2024-09").leadingBlanks` = 6 (1일이 일요일) · `"2026-06"` = 0 (1일이 월요일) · 기존 `2024-03` 기대값 5 → 4 로 갱신. `WEEKDAY_LABELS` 길이 7 · 첫 원소 "월".
- [x] F9 로컬 `next dev`: `/history/2026/09` 월 그리드 (2026-09-01 화 → 빈 칸 1) · `/history/2026` 연간 카드 · `/lifestyle` 히트맵 헤더 `월…일`.
- [ ] F10 `docs/roadmap.md` M17-4 · `docs/specs/M14-followup.md`.

## 4. 기술 설계

```
month-cells.ts   WEEKDAY_LABELS · weekdayIndexMon · monthCells (leadingBlanks 월요일 기준)
   ├─ view.ts (변경 없음) → MonthGrid · YearMonthCard
   └─ MonthlyHeatmap (신규 소비자 — 자체 달력 계산 제거)
```

`(getUTCDay() + 6) % 7` — 일요일 (0) → 6, 월요일 (1) → 0. ymd 문자열 + `Date.UTC` 라 서버 TZ 무관 (기존 규칙 유지).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/history/month-cells.ts` (+ 테스트) | `WEEKDAY_LABELS` · `weekdayIndexMon` · `dayOfWeekYmd` 제거 |
| `src/components/history/MonthGrid.tsx` | 헤더 상수 |
| `src/components/lifestyle/MonthlyHeatmap.tsx` | `monthCells` 소비 · KST 오늘 |
| `docs/specs/445-monday-start-grids.md` · `docs/roadmap.md` · `docs/specs/M14-followup.md` | 문서 |

## 6. 테스트 계획

- §3 F8 vitest.
- 4종 검증 · 로컬 3화면 확인 (F9). 디자인 단계는 열 순서 변경뿐이라 생략 — 실화면 캡처를 스펙에 첨부.
- 사전 리뷰: `src/**` 로직 (`month-cells.ts`) 변경 → 에이전트 리뷰 1회 (8-0).

## 7. 제외 사항

- 대시보드 주간 차트 (롤링 7일 — 시작 요일 개념 없음) · 요일 라벨만 쓰는 내비게이션.
- 주말 강조 · 주 번호 표시.
- 주간 버킷 · 트레이닝 플랜 캘린더 (이미 월요일).
