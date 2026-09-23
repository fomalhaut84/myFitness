# [M17 #5] 리포트 근거 확장 — Phase 1: 도구 필드 · 활동 컨텍스트 도구 · 프롬프트

> **초안 (2026-09-24) — 사용자 승인 전.** 항목별 채택은 기획 승인 때 확정한다. F7 직전 4주 창은 PR #453 Codex P2 반영본.

- **작성일**: 2026-09-24
- **타입**: feature
- **이슈**: #444 (P2 · 사용자 댓글로 범위 확대 — 지표 전체 점검 결과는 이슈 댓글 2026-09-23)
- **브랜치**: `feat/444-1`
- **의존**: #440 (`buildEvalContext` · `loadActivityEvalInput`, v2.37.0) · #425 (`hrr2`) · M4-5 (`zoneDistribution`). 스키마 변경 없음 · 패키지 추가 없음.

## 1. 배경

모닝/이브닝/주간 리포트는 자연어 프롬프트 + `minTurns: 2` 로 **모델이 MCP 도구를 골라 호출**한다 (`src/lib/daily-report.ts` · `weekly-report.ts`). 점검 (이슈 댓글) 결과 DB 에는 있는데 리포트가 못 보는 근거가 12개 (A1~A12). Phase 1 은 그중 **도구 필드 추가 · 프롬프트 한 줄** 로 끝나는 것들이고, 새 계산이 필요한 것 (개인 기록 도구 · 수면 규칙성 · 다이나믹스 추세) 은 Phase 2 (별도 이슈).

실코드 재검증 (2026-09-24):

| 지점 | 현황 |
|---|---|
| `get_activities` (`src/mcp/tools/fitness.ts`) | select 에 `hrr2` · `hrrDrop10` · `zoneDistribution` 없음. daily 응답은 행 배열 + envelope, 주/월은 `aggregateActivities` |
| MCP 가 웹 앱을 부르는 선례 | `get_activity_splits` 는 `APP_BASE_URL` 로 `/api/activities/{id}/splits` 를 **HTTP 호출** (Garmin 세션을 웹 프로세스 하나에만 두기 위해). 컨텍스트 도구도 같은 경로 — MCP 프로세스에서 Garmin 을 직접 부르지 않는다 |
| MCP 번들의 `@/lib/prisma` | `@/lib/history/coverage` 가 이미 import (선례) — 쓸 수는 있으나 위 이유로 HTTP 경유 |
| 모닝 프롬프트 | `get_blood_pressure` 없음 (시스템 프롬프트의 일간 BP 경고 규칙이 작동 안 함) · `recommend_today_workout` 미명시 |
| 이브닝 프롬프트 | 오늘 러닝을 `get_activities` 필드로만 (스플릿 파생 · 같은 코스 · HRR 없음) · 기상 영향 미요구 |
| 주간 프롬프트 | 도구 10개 명시. `get_fitness_metric_trend` · `get_active_training_plan` 없음 · 존 분포 · HRR 없음 |
| `claude-advisor.ts` `--allowedTools` | 새 read-only 도구는 여기 추가해야 `-p` 에서 승인 없이 실행 (#377). `verify-mcp-long-history [7]` 이 server.ts 등록 ⊆ allowlist 를 검사 |
| 수면 SpO2 | `get_sleep` 에 이미 있음 — 누락 아님 |

## 2. 목표

1. 이브닝 리포트가 오늘 러닝을 **활동 상세 AI 평가와 같은 근거** (섹션 8개) 로 본다.
2. 주간 리포트가 **존 분포 80/20** · **HRR 주간 중앙값** · **VO2max/LT 변화** · **플랜 준수율** 을 말한다.
3. 모닝 리포트가 **혈압** (측정 있는 날) 을 본다 — 이미 있는 경고 규칙이 실제로 작동.
4. 계산은 순수 함수 + vitest. 프롬프트는 도구 이름 · 인자를 명시 (#203 선례 — 자연어만 두면 Sonnet 이 호출을 건너뛴다).

## 3. 요구사항

**도구 필드 (A1 · A2)**
- [ ] F1 `get_activities` daily 응답의 활동 행에 `hrr2` · `hrrDrop10` · `zones: { z1..z5 초 } | null` · `zonePct: { z1..z5 % } | null`.
- [ ] F2 envelope 에 `runningSummary` (러닝 계열만 · daily 일 때): `{ n, zoneTotalsSec, easyPct (Z1+Z2), hardPct (Z4+Z5), hrr2: { median, n } }` — 순수 함수 `summarizeRunningWindow(rows)` (`src/lib/fitness/running-window.ts`). 존 합이 0 이거나 hrr2 가 없으면 각 필드 null. `_context` 에 "80/20 = 이지 (Z1+Z2) 시간 비율 80% 안팎이 polarized 기준" 한 줄.

**활동 컨텍스트 (A6 · A11)**
- [ ] F3 웹 `GET /api/activities/[id]/context` — `loadActivityEvalInput` → `buildEvalContext` → `{ mode, sections, omitted }` (LLM 호출 없음 · 저장 없음). 404 / 500 은 기존 규칙.
- [ ] F4 MCP `get_activity_context(activityId)` — `get_activity_splits` 와 같은 id 해석 (cuid 또는 garminId) → `APP_BASE_URL` 로 F3 호출 → 그대로 반환. 실패 시 `errorPayload`. `server.ts` 등록 + `claude-advisor.ts` allowlist + `system-prompt.ts` 도구 가이드 한 줄 ("오늘/특정 러닝을 평가할 때 — 스플릿 파생 · 같은 코스 · HRR 기준선까지").

**프롬프트 (A3 · A4 · A7 · A11)**
- [ ] F5 모닝: `get_blood_pressure(days=7)` 한 줄 ("측정이 있으면 7일 평균 · 경고 규칙, 없으면 생략") · `recommend_today_workout` 명시 ("오늘의 운동 추천은 이 도구의 결과를 근거로").
- [ ] F6 이브닝: "오늘 러닝이 있으면 활동마다 `get_activity_context(activityId)` 를 호출해 스플릿 · 회복 · 같은 코스 비교까지 근거로 분석. 기상 (환경 섹션) 이 페이스/심박에 준 영향 한 줄".
- [ ] F7 주간: 도구 목록에 `get_fitness_metric_trend(days=13, granularity="daily")` · `get_active_training_plan()` 추가. 항목에 (a) 존 분포 80/20 (`runningSummary.easyPct`) 이번 주 vs 직전 4주 (b) HRR 주간 중앙값 vs 직전 4주 (c) VO2max 변화 · LT 감지 (d) 플랜 있으면 준수율 (completed / missed).
  - **직전 4주 창 (PR #453 Codex P2 · 이슈 댓글 2026-09-24):** `days=N` 은 오늘 포함 창이라 `days=27` 만 쓰면 이번 주가 기준선에 섞인다 → `get_activities(days=27, endDate=<오늘 − 7일>)` (= [오늘−34, 오늘−7]) 로 **이번 주를 제외**. 프롬프트가 `days=6` (이번 주) 와 이 호출 둘을 명시하고, `runningSummary._context` 에 "endDate 없는 창은 오늘 포함" 한 줄. 존 80/20 비교도 같은 두 창.
- [ ] F8 프롬프트 회귀 테스트 `src/lib/__tests__/report-prompts.test.ts` — 세 프롬프트가 요구 도구 이름을 포함하는지 (문자열 검사 · 프롬프트를 export).

**검증 · 문서**
- [ ] F9 vitest: `summarizeRunningWindow` (존 합 · 80/20 · hrr2 중앙값 · 빈 창) · `get_activity_context` id 해석 (기존 `tryParseGarminId` 재사용) · 프롬프트 문자열.
- [ ] F10 `verify-mcp-long-history` 통과 (allowlist 정합). 로컬: MCP 도구 직접 호출 1회 (`npm run mcp:call` 류가 있으면, 없으면 `curl` 로 F3) · 이브닝 리포트 로컬 생성 1회 (Claude CLI 필요).
- [ ] F11 `docs/roadmap.md` M17-5 · `docs/specs/M14-followup.md` · Phase 2 이슈 생성 (A5 개인 기록 도구 · A8 체지방/근육량 · A9 강도 분 · A10 수면 규칙성 · A12 다이나믹스 추세).

## 4. 기술 설계

```
web  GET /api/activities/[id]/context ─── loadActivityEvalInput → buildEvalContext (#440 재사용, LLM 없음)
mcp  get_activity_context(activityId) ─── APP_BASE_URL fetch (splits 선례) → 그대로 반환
mcp  get_activities ─── select += hrr2 · hrrDrop10 · zoneDistribution → 행: zones · zonePct · hrr2 / envelope: runningSummary (순수 summarizeRunningWindow)
prompts  daily-report.ts (모닝 · 이브닝) · weekly-report.ts — 도구 이름 · 인자 명시 (export 해서 테스트)
claude-advisor.ts allowlist += get_activity_context · system-prompt.ts 가이드 한 줄
```

**왜 HTTP 경유인가** — Garmin 세션 (`withReauth`) 은 웹 프로세스에만 둔다 (splits 선례). MCP 가 직접 `loadActivityEvalInput` 을 부르면 스플릿 조회가 MCP 프로세스에서 Garmin 로그인을 시도한다.

**80/20 정의** — 이지 = Z1+Z2 시간, 하드 = Z4+Z5, Z3 은 중간 (표시만). 비율은 존 시간 합 기준 (활동 수 아님).

**주간 HRR · 80/20 비교** — 도구에 "직전 4주" 창을 넣지 않고 프롬프트가 `days=6` 과 `days=27, endDate=오늘−7일` 두 번 부르게 한다 (도구는 단순하게 · 이번 주 제외).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/fitness/running-window.ts` (+ 테스트) | 신규 — `summarizeRunningWindow` |
| `src/mcp/tools/fitness.ts` | `get_activities` select · 행 매핑 · `runningSummary` |
| `src/mcp/tools/activity-context.ts` (+ 테스트) · `src/mcp/server.ts` | 신규 도구 |
| `src/app/api/activities/[id]/context/route.ts` | 신규 |
| `src/lib/ai/claude-advisor.ts` · `src/lib/ai/system-prompt.ts` | allowlist · 가이드 |
| `src/lib/daily-report.ts` · `src/lib/weekly-report.ts` (+ `src/lib/__tests__/report-prompts.test.ts`) | 프롬프트 · export |
| `docs/specs/444-report-evidence.md` · `docs/roadmap.md` · `docs/specs/M14-followup.md` | 문서 |

## 6. 테스트 계획

- `running-window.test.ts`: 존 합 · easy/hard % (반올림) · Z3 · 존 없는 활동 제외 · hrr2 중앙값 (홀짝 · 없음 null) · 러닝 외 제외 · 빈 창.
- `activity-context.test.ts`: id 해석 · fetch 실패 → errorPayload (fetch 모킹).
- `report-prompts.test.ts`: 모닝 (`get_blood_pressure` · `recommend_today_workout`) · 이브닝 (`get_activity_context`) · 주간 (`get_fitness_metric_trend` · `get_active_training_plan` · `days=27` 와 `endDate` 동반).
- `npm run test` 의 `verify-mcp-long-history [7]`.
- 로컬: `curl localhost:3000/api/activities/<id>/context` · MCP HTTP 로 `get_activities(days=6)` 응답에 `runningSummary` 확인.

## 7. 제외 사항 (Phase 2 · 별도 이슈)

- A5 `get_personal_records` 도구 · "이번 주 신기록" · A8 체지방/근육량 · A9 강도 분 (WHO) · A10 수면 규칙성 · A12 다이나믹스 4주 추세.
- 리포트 프롬프트 전면 개편 · 리포트 형식 변경.
- `get_activities` 주/월 집계 경로의 존 · HRR (daily 만).
