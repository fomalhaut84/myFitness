# [M17-6] 리포트 근거 확장 Phase 2 — 개인 기록 도구 · 체지방/근육량 · 강도 분 · 수면 규칙성 · 다이나믹스 추세

- **작성일**: 2026-09-24
- **타입**: feature
- **이슈**: #455 (P2 · #444 후속)
- **브랜치**: `feat/455-1`
- **의존**: #444 Phase 1 (v2.38.0 — `runningSummary` · `report-prompts.ts` · `web-api.ts`) · #396 (`records.ts`). 스키마 · 패키지 변경 없음.

## 1. 배경

#444 점검 (이슈 댓글 2026-09-23) 중 **새 계산 · 새 도구** 가 필요한 항목. Phase 1 과 같은 원칙 — 계산은 순수 함수 + vitest, 프롬프트는 도구 이름 · 인자 명시, MCP 가 prisma 무거운 lib 을 부를 땐 웹 API 경유 (`web-api.ts`).

| # | 지표 | 현황 | 이번 일 |
|---|---|---|---|
| A5 | 개인 기록 갱신 | `records.ts` 서버 함수만 · 도구 없음 | `GET /api/history/records` + MCP `get_personal_records` |
| A8 | 체지방 · 근육량 | `get_body_composition` 에 있음 | 주간 프롬프트 한 줄 (값 있는 주만) |
| A9 | 강도 분 (WHO 150분/주) · 층수 | `get_daily_stats` 행에 있음 | daily envelope `totals` (순수 합) + 주간 프롬프트 |
| A10 | 수면 규칙성 | `get_sleep` 에 시각 있음 · `/lifestyle` 은 컴포넌트 안 계산 | 순수 `sleepRegularity` → `get_sleep` daily envelope `regularity` + 주간 프롬프트 |
| A12 | 러닝 다이나믹스 추세 | `get_activities` 행에 있음 | `runningSummary.dynamics` (중앙값) + 주간 두 창 비교 |

## 2. 요구사항

**A5 개인 기록**
- [x] F1 `GET /api/history/records` — `getCachedPersonalRecords({ lowerBound: getCachedLowerBound(), today })`. 응답은 `PersonalRecords` 그대로 + `lowerBound` · `today`.
- [x] F2 MCP `get_personal_records()` — `fetchWebJson("/api/history/records")` → 페이스 포맷 (`paceMinKm`) 을 덧붙여 반환. `_context`: "전 기간 [lowerBound, today] 랭킹 · 동률은 먼저 달성한 날 · 오늘/이번 주 활동이 기록과 같은 id/날짜면 신기록". `server.ts` 등록 · allowlist · 시스템 프롬프트 가이드.

**A9 강도 분**
- [x] F3 `summarizeDailyWindow(rows)` (`src/lib/fitness/daily-window.ts`, 순수) → `{ days, intensityMinTotal, floorsClimbedTotal, daysWithIntensity }` (null 은 0 이 아니라 제외 · 값 있는 날 수). `get_daily_stats` daily envelope `totals` + `_context` "WHO 권고 주 150분 (Garmin 강도 분은 고강도 2배 가중)".

**A10 수면 규칙성**
- [x] F4 `src/lib/sleep/regularity.ts` (순수): `clockHoursKST(date)` (KST 시각 → 소수 시간, 18시 이후는 −24 로 접어 자정 기준) · `sleepRegularity(rows: { sleepStart: Date; sleepEnd: Date }[])` → `{ n, bedtime: { meanClock, stdDevHours }, wake: { meanClock, stdDevHours }, label }`. 라벨 임계는 `/lifestyle` `SleepRegularity` 와 같은 값 (0.5 / 1.0 / 1.5 h → 매우 규칙적 / 규칙적 / 보통 / 불규칙) 을 한 곳 (`regularityLabel`) 에 두고 컴포넌트가 import. n < 2 이면 null.
- [x] F5 `get_sleep` daily envelope `regularity` + `_context` 한 줄.

**A12 다이나믹스**
- [x] F6 `summarizeRunningWindow` 에 `dynamics: { cadence, strideLengthM, groundContactTimeMs, verticalOscillationCm }` — 각 `{ median, n } | null`. `RunningWindowRow` 에 네 필드 추가 (`get_activities` select 에 이미 있음).

**프롬프트**
- [x] F7 이브닝: `get_personal_records()` — "오늘 러닝의 id/날짜가 byBucket · longest · bestHrr2 와 같으면 신기록 축하 한 줄, 아니면 생략".
- [x] F8 주간: `get_personal_records()` (이번 주 날짜의 신기록) · `get_body_composition(days=27)` (bodyFat · muscleMass 값 있는 주만 추세 한 줄) · 항목 추가 — 강도 분 합 vs 150분 (`totals.intensityMinTotal`) · 수면 규칙성 (`regularity.label` · 취침 표준편차) · 다이나믹스 (이번 주 vs 직전 4주 `runningSummary.dynamics` 케이던스 · GCT — 부상 예방 신호).
- [x] F9 `report-prompts.test.ts` 갱신.

**검증 · 문서**
- [x] F10 vitest: `daily-window` · `regularity` (KST 접기 · 표준편차 · 라벨 · n<2) · `running-window` dynamics · `personal-records` 도구 (fetch 모킹) · 프롬프트. `verify-mcp-long-history [7]`.
- [x] F11 로컬: `curl /api/history/records` · `tsx` 로 `get_personal_records` · `get_sleep(days=13)` `regularity` · `get_daily_stats(days=6)` `totals`.
- [ ] F12 `docs/roadmap.md` M17-6 · `M14-followup.md`.

## 3. 기술 설계

```
web  GET /api/history/records ── getCachedPersonalRecords (캐시 · 무효화는 cache-core 규칙 그대로)
mcp  get_personal_records ── fetchWebJson → + paceMinKm
lib  fitness/daily-window.ts · sleep/regularity.ts · fitness/running-window.ts (dynamics)
mcp  get_daily_stats totals · get_sleep regularity · get_activities runningSummary.dynamics (daily 에만)
prompts  report-prompts.ts 이브닝 · 주간
```

**왜 records 는 HTTP 경유** — `records.ts` 는 `@/lib/prisma` + `getHistorySummary` (히스토리 집계 전체) 를 끌어온다. MCP 번들에 넣지 않고 웹의 메모리 캐시를 그대로 쓴다 (splits · context 선례).

**수면 시각 KST** — `/lifestyle` 은 `getHours()` (서버 로컬 TZ · #365 잔여). 새 함수는 `Intl` KST 로 계산하고, 컴포넌트는 라벨 임계만 공유 (페이지 계산 교체는 #365).

## 4. 제외

- `/lifestyle` 페이지 자체의 TZ 정정 (#365).
- 주/월 집계 경로의 totals · regularity · dynamics (daily 만).
- 신기록 알림 (텔레그램 push) — 리포트 본문 언급까지.

## 5. 구현 결과 (2026-09-24 · `feat/455-1`)

| 항목 | 결과 |
|---|---|
| F1 · F2 | `GET /api/history/records` (`force-dynamic` · `/trends` 와 같은 캐시 키) · `personal-records.ts` (`fetchWebJson` · `withPaceOrNull` — 키 결측도 null · 형태 검증에 `longest`) |
| F3 | `daily-window.ts` — `rowCount` (창 안 DailySummary 행 수 · envelope `days` 와 다름을 `_context` 에 명시) |
| F4 · F5 | `sleep/regularity.ts` — 취침만 18시 이후 −24 접기 (기상은 접지 않음 · `/lifestyle` 과 동일). `SleepRegularity` 컴포넌트가 `regularityLabel` 을 import |
| F6 | `dynamics` 중앙값. **보폭은 cm 혼재 행 정규화** — 로컬 실행에서 중앙값 83.56 (cm) 이 나와 발견. `fitness/stride.ts` 를 활동 평가 (`sections.ts`) 와 공용. 표시용 `strideCm` 은 원식 유지 (`/100*100` 은 .5 경계에서 1cm 어긋남 — 사전 리뷰 info 1) |
| F7~F9 | 이브닝 신기록 · 주간 15항목 (신기록 · 다이나믹스 · 강도 분 · 규칙성 · 체지방/근육량 추가) · 프롬프트 회귀 |
| F10 | vitest 312 → 325 · `verify-mcp-long-history [7]` 통과 (등록 25) |
| F11 | 로컬 `next dev`: `/api/history/records` 200 · `get_personal_records` (5k 기록 · paceMinKm) · `get_sleep` regularity (로컬 DB 의 옛 행은 KST-as-UTC 라 값은 무의미 — 계산은 단위 테스트) · `get_daily_stats` totals 는 로컬 DailySummary 0행이라 단위 테스트만 · `runningSummary.dynamics` (cadence 182 · GCT 271) |
| 사전 리뷰 | code-reviewer 1회: critical 0 · major 0 · **info 4 전부 반영** (strideCm 원식 · withPace 타이핑/가드 · dynamics 안내 · `rowCount`) |
| 봇 1회차 | Codex **P1**: `intensityMin` 은 moderate + vigorous 단순합 (endpoint audit A10) 인데 150분 (vigorous ×2 가중) 과 비교 → rawData 성분으로 `weightedIntensityMinTotal` · `moderateMinTotal` · `vigorousMinTotal` · `daysWithComponents` 를 따로 노출, 프롬프트는 가중 합으로 비교 (null 이면 단순합을 "최소" 로만). 회귀 `daily-window.test.ts` |
| 미실행 | 리포트 실생성 (Claude CLI 쿼터). 배포 후 이브닝 (러닝 있는 날) · 주간 리포트에서 `get_personal_records` 호출 · 규칙성 · 강도 분 항목 확인 |
