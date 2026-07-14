# [feat] Training Plan — 기간 커스텀 (weekCount 4~24) (M11 Phase 1)

- **작성일**: 2026-07-14
- **이슈**: #222
- **관련 마일스톤**: [M11 Training Plan Customization](./M11-training-plan-advancement.md)
- **범위**: Phase 1 (기간 커스텀). 목표 유형 확장(Phase 2)/자동 조정(Phase 3) 은 별도 이슈.

## 목적

트레이닝 플랜의 4주 고정(`21 * DAY_MS` 하드코딩) 제한을 제거하고 사용자가 **4~24주** 범위에서 자유롭게 지정. Marathon prep (통상 12~16주) / 5K sub-goal (4~8주) / HM (10~14주) 등 다양한 시나리오 대응.

## 요구사항

- [x] **F1 · Schema** — `TrainingPlan.weekCount Int @default(4)` 필드 추가 + 수동 SQL migration. 기존 record 는 DEFAULT 4 로 백필됨.
- [x] **F2 · Generator** — `plan-generator.ts` 의 4-week 하드코딩 제거. `weekCount` 를 `PlanGeneratorInput` 에 추가하고 loop 는 `for (let week = 0; week < weekCount; week++)`.
- [x] **F3 · Weekly progression** — `computeWeeklyProgression(weekCount)` 로 정규화. 마지막 1~2주 taper, 나머지 growth (1.0 → 1.2 선형). 4주 케이스는 기존 `[1.0, 1.1, 1.2, 0.8]` 유지.
- [x] **F4 · Validation** — MCP `generate_training_plan` 이 weekCount 4~24 검증. 유효하지 않으면 사용자 오류로 throw.
- [x] **F5 · targetDate 범위** — `finalWeekStart = startDate + (weekCount-1)*7 일` 로 일반화. targetDate 는 `[finalWeekStart, endDate]` 창 내여야 함.
- [x] **F6 · API Zod** — `weekCount: z.number().int().min(4).max(24).optional()`.
- [x] **F7 · UI** — `/training-plan` 페이지 `GeneratePlanForm` 에 기간 입력 (프리셋 4/8/12/16 + 정수 필드). 헤더 "N-Week Ledger" 로 실제 주수 표시.
- [x] **F8 · MCP 응답** — `get_active_training_plan` payload 에 `weekCount` 포함. history/detail 도 동일.

## 기술 설계

### Weekly progression 로직 (`src/lib/training/weekly-progression.ts`)

```
taperWeeks   = weekCount ≤ 8 ? 1 : 2
growthWeeks  = weekCount - taperWeeks
growth       = linearRamp(1.0, 1.2, growthWeeks)   // 마지막이 peak
taper        = taperWeeks === 1 ? [0.8] : [0.85, 0.7]
multipliers  = [...growth, ...taper]  // 길이 = weekCount
peakWeekIdx  = growthWeeks - 1
```

검증 예:

| weekCount | multipliers |
|----|----|
| 4 | `[1.0, 1.1, 1.2, 0.8]` (기존과 동일) |
| 8 | `[1.0, 1.033, 1.067, 1.1, 1.133, 1.167, 1.2, 0.8]` |
| 12 | `[1.0, 1.022, ..., 1.2, 0.85, 0.7]` |
| 16 | `[1.0, ..., 1.2, 0.85, 0.7]` |
| 24 | `[1.0, ..., 1.2, 0.85, 0.7]` |

### Race taper window

`RACE_TAPER_WINDOW_DAYS = 6` 유지. 창 수집 loop 는 `offset < weekCount * 7`. 즉, targetDate 이전 6일간의 workout slot 은 선형 0.6 → 0 감소 (기존 로직 그대로).

### Peak long-run 최소 거리 보장 (M8 규칙)

`week === progression.peakWeekIdx` (기존 `week === 2` 대신). 4주 케이스에서 peakWeekIdx = 2 → 완전히 동일한 동작.

### targetDate 범위 예시

- weekCount=4, startDate=8/1 → finalWeekStart=8/22, endDate=8/28 → 기존과 동일
- weekCount=12, startDate=8/1 → finalWeekStart=10/17, endDate=10/23
- weekCount=16, startDate=8/1 → finalWeekStart=11/14, endDate=11/20

### DB 마이그레이션

`prisma migrate dev` 는 이전 수동 편집으로 drift 상태이므로 수동 SQL:

```
prisma/migrations/20260714044033_m11_training_plan_week_count/migration.sql
```

`ALTER TABLE "TrainingPlan" ADD COLUMN "weekCount" INTEGER NOT NULL DEFAULT 4;`

`_prisma_migrations` INSERT (id="20260714044033_m11_wc") 로 Prisma 이 이미 적용된 것으로 인식.

## 변경 파일

**신규**
- `prisma/migrations/20260714044033_m11_training_plan_week_count/migration.sql`
- `src/lib/training/weekly-progression.ts`

**수정**
- `prisma/schema.prisma` — TrainingPlan.weekCount, TrainingWorkout.weekNumber 주석
- `src/lib/training/plan-generator.ts` — weekCount 파라미터화, WEEKLY_MULTIPLIERS 대체
- `src/lib/training/workout-patterns.ts` — WEEKLY_MULTIPLIERS 상수 제거
- `src/lib/training/plan-history.ts` — HistoryItem.weekCount 추가
- `src/lib/training/plan-detail.ts` — PlanDetailResponse.plan.weekCount 추가
- `src/mcp/tools/training-plan.ts` — validation, endDate, finalWeekStart, weekCount 저장/반환
- `src/mcp/server.ts` — generate_training_plan tool description 갱신
- `src/app/api/training-plan/generate/route.ts` — Zod weekCount + 오류 시그니처 갱신
- `src/app/training-plan/types.ts` — ActivePlanPayload/HistoryItem 에 weekCount 필드
- `src/app/training-plan/page.tsx` — "N-Week Ledger" 동적 제목
- `src/app/training-plan/components/GeneratePlanForm.tsx` — 기간 입력 UI
- `src/app/training-plan/components/PlanCalendar.tsx` — 가변 주 buckets, "마지막 주 pre-race window" 문구
- `src/app/training-plan/components/ArchivedList.tsx` — weekCount 뱃지
- `src/app/training-plan/history/[planId]/page.tsx` — 기간 stat, 동적 제목

## 테스트 계획

- 4주 회귀: baseline 20km, weeklyFrequency 4, targetDistance/targetDate 없이 생성. 기존 v2.11.0 결과와 workout 개수·distance·pace 완전 일치 여부 확인.
- 8주 · 12주 · 16주 각각 생성 → workout 개수 = weekCount × weeklyFrequency (rest 제외 슬롯 기준), 마지막 주가 taper 배율인지 검증.
- targetDate: `finalWeekStart` 이전은 400 에러, 창 내는 정상 생성.
- weekCount 경계: 3 · 25 · 소수 → 400 에러. 4 · 24 → 정상.
- UI: /training-plan 에서 기간 입력 → 생성 → 캘린더에 weekCount 만큼 행 렌더.

## 제외 (별도 이슈 / 후속 Phase)

- Phase 2: 목표 유형 확장 (기록/지속력/감량) — 마일스톤 참조
- Phase 3: 진행 트래킹 & 자동 조정 (미확정)
- WEEKLY_MULTIPLIERS 상수 제거로 기존 외부 import 가 있을 경우 대비 — 확인 결과 프로덕션 code path 에는 없음 (grep 검증 완료).
