# M11: Training Plan Customization (마일스톤)

- **작성일**: 2026-07-14
- **타입**: milestone
- **관련 이슈**: (Phase 별 개별 이슈)

## 목적

트레이닝 플랜의 유연성 확장. 현재 **4주 고정 / 거리 목표만** 지원하는 구조를 다양한 사용 시나리오 (5K sub-goal, HM/FM 대회 준비, 감량 병행, 지속력 훈련) 로 확장.

## 현재 한계

- 기간이 **4주 고정** (`21 * DAY_MS` 하드코딩)
- 목표는 **거리만** (5K/10K/HM/FM) — 기록/체중/지속력 미지원
- Marathon 준비도 4주로 강제 → 관례상 12~16주 필요

## Phase 구성

### Phase 1 — 기간 커스텀 (`weekCount`)
- 사용자가 **4~24주** 자유 지정
- `TrainingPlan.weekCount Int @default(4)` 필드 추가
- Generator 를 weekCount 기반으로 일반화
- UI 에 기간 입력 필드
- **선행 없음** — 우선 착수

### Phase 2 — 목표 유형 확장
- **F1. 목표 기록** (`targetTime` sec)
  - 예: 10K sub-50 → 회복/지속/템포/인터벌 페이스 progression
  - 현재 baseline 페이스 vs 목표 페이스 gap → 주간 개선률 산출
- **F2. 지속력** (`enduranceGoal` km)
  - long run 최대 거리 progression
  - 예: 현재 12km → 20km 목표 8주간 단계적 증대
- **F3. 감량 병행** (`weightLossPace` kg/week)
  - 훈련 강도 조정 (kcal deficit 고려)
  - 고강도 vs 저강도 비율 재조정
  - Phase 1 완료 후 착수

### Phase 3 — 진행 트래킹 & 자동 조정 (검토 단계)
- 실제 훈련 로그 vs 계획 편차 → next week 조정 제안
- HRV/피로도 기반 강도 감소 (readiness score 연동)
- Zone 별 시간 목표 달성률 표시
- **미확정** — Phase 1~2 안정화 후 검토

### Phase 4 — 다중 목표 & 시즌 (검토)
- 감량 + 기록 동시 목표
- Peak/taper 자동 배분
- **미확정** — 향후 논의

## Phase 1 요구사항 (착수 준비 완료)

- **F1**: Schema — `TrainingPlan.weekCount Int @default(4)` + migration (기존 record 는 4 로 초기화)
- **F2**: Generator (`plan-generator.ts`) — `21 * DAY_MS` 하드코딩 제거, `weekCount * 7 - 1` 기반 endDate
- **F3**: Weekly progression 로직 — 주차별 volume ramp 를 `weekCount` 로 정규화 (예: 첫 25% ramp → mid load → final taper)
- **F4**: `training-plan.ts` (validation) — `weekCount` param (4~24), 기본 4
- **F5**: `targetDate` 유효 범위 — 마지막 주 창 (`finalWeekStart`~`endDate`) 로 일반화
- **F6**: API `/api/training-plan/generate` — Zod schema 에 `weekCount` 추가
- **F7**: UI (`/training-plan` 페이지) — 기간 입력 필드 (default 4)
- **F8**: MCP `get_active_training_plan` 응답에 `weekCount` 포함
- **F9**: 스펙 문서

## Phase 2 요구사항 (Phase 1 완료 후)

- **F1**: `TrainingPlan.goalType String @default("distance")` + `goalValue Json?`
  - `goalType`: `"distance" | "time" | "endurance" | "weight_loss"`
- **F2**: Generator 확장 — `goalType` 별 progression 로직
- **F3**: 다중 목표 지원 검토 (goalType 배열?) — Phase 4 로 미루기

## 참고

- 현재 스키마: `prisma/schema.prisma:237~272` (TrainingPlan, TrainingWorkout)
- Generator: `src/mcp/tools/training-plan.ts` (validation) + `src/lib/training/plan-generator.ts` (workout 생성)
- 스케일: `src/lib/training/plan-scaling.ts`
- API: `src/app/api/training-plan/generate/route.ts`
