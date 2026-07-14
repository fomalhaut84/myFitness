# M12: Personal Goals — 평상 개인 목표 (마일스톤)

- **작성일**: 2026-07-14
- **타입**: milestone / feature
- **이슈**: #223
- **관련**: M11 (트레이닝 플랜 고도화, 이슈 #222 pending)

## 목적

트레이닝 플랜 (기간 지정, 대회 준비) 과 별개로 사용자의 **장기 개인 목표** (ongoing) 를 설정 → AI 어드바이저 조언 시 컨텍스트로 자동 활용.

## 목표 유형 (4개, Phase 1+2 통합 착수)

| 유형 | 필드 | 예시 | 진행도 계산 |
|---|---|---|---|
| 평균 페이스 개선 | `targetAvgPace` (sec/km) | 5:45 = 345 | 최근 30일 러닝 거리 가중 avg |
| 주간 러닝 거리 | `targetWeeklyKm` (Float) | 30 | 최근 4주 총 km / 4 |
| VO2max 향상 | `targetVO2max` (Float) | 45 | UserProfile.vo2maxRunning |
| 커스텀 텍스트 | `personalGoalNote` (String) | "부상 없이 완주" | AI 정성 판단 |

**기존 필드 활용**: `targetWeight`, `targetCalories`, `targetDate` — 이미 존재. Settings UI 에서 함께 노출.

## Phase 1: Schema + Settings UI

- **F1** ✅ `UserProfile` 에 4개 필드 추가 (모두 nullable). Migration: `20260714_m12_personal_goals` (수동 SQL, 로컬 dev DB drift 회피).
- **F2** ✅ Settings UI 확장 (`src/app/settings/profile/*`) — 4개 필드 입력, 페이스는 M:SS 형식 자동 변환.
- **F3** ✅ PATCH `/api/profile` — 새 필드 지원 (Zod schema + updatePayload passthrough).

## Phase 2: AI 통합

- **F4** ✅ `system-prompt.ts` — `buildPersonalGoalsSection()` 으로 컨텍스트 삽입. 미설정 시 빈 문자열 → 항목 자체 생략.
- **F5** ✅ MCP tool `get_personal_goals` — `configured` flag + goals 반환.
- **F6** ✅ `src/lib/personal-goals.ts` — `computePersonalGoals()` + `formatGoalsForPrompt()` helper.
- **F7** ✅ 리포트 프롬프트 (모닝/이브닝/주간) — 목표 진행 상황 언급 지시 추가.

## Phase 3: 대시보드 UI (검토, 별도 이슈)

- 각 목표별 시각화 (게이지/차트) — 우선순위 낮음
- 진행도 추세 그래프

## 파일 변경

- `prisma/schema.prisma` — `UserProfile` +4 필드
- `prisma/migrations/20260714*_m12_personal_goals/migration.sql` (수동)
- `src/lib/personal-goals.ts` (신규) — 진행도 helper + prompt formatter
- `src/mcp/tools/personal-goals.ts` (신규) — MCP tool
- `src/mcp/server.ts` — tool 등록
- `src/lib/ai/claude-advisor.ts` — allowedTools 확장
- `src/lib/ai/system-prompt.ts` — 개인 목표 section 삽입
- `src/lib/daily-report.ts`, `src/lib/weekly-report.ts` — 프롬프트 목표 언급 지시
- `src/app/api/profile/route.ts` — Zod schema + updatePayload
- `src/app/settings/profile/page.tsx`, `profile-client.tsx` — UI

## 검증

- Settings 각 필드 저장 → DB → GET 조회 → 프론트 반영
- 목표 설정 후 `/ai 오늘 러닝 어때?` → 시스템 프롬프트 컨텍스트에서 목표 참조
- 모닝/이브닝/주간 리포트에 개인 목표 진행 상황 섹션 등장
- 목표 미설정 시 프롬프트에 항목 자체 생략 (빈 컨텍스트)

## 제외

- Phase 3 (대시보드 시각화) — 별도 이슈
- 목표 달성 알림 (텔레그램 push) — 별도
- 다중 목표 그룹핑 (여러 러닝 목표 등) — 향후

## 관련

- M11 (트레이닝 플랜 고도화): 이슈 #222 pending (별도 진행)
