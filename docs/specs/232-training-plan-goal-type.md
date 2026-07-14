# [feat] Training Plan — 목표 유형 확장 (time + endurance) (M11 Phase 2)

- **작성일**: 2026-07-14
- **이슈**: #232 (예정)
- **관련 마일스톤**: [M11 Training Plan Customization](./M11-training-plan-advancement.md)
- **선행**: [#222 (Phase 1: weekCount)](./222-training-plan-week-count.md) 완료
- **범위**: `goalType` 도입 + `"time"` (기록) / `"endurance"` (지속력) 두 유형 신규 지원. `"weight_loss"` 는 별도 이슈.

## 목적

현재 훈련 목표는 거리(5K/10K/HM/FM) 기반 taper 만 제공. Marathon sub-4 같은 **기록 목표**나 "long run 12km → 25km" 같은 **지속력 목표** 는 미지원 → generator progression 이 목표별로 달라야 함.

## 요구사항

- **F1 · Schema** — `TrainingPlan.goalType String @default("distance")` 필드 + `TrainingPlan.goalValue Json?` 페이로드 필드 + migration. 기존 record 는 DEFAULT `"distance"` 로 백필.
  - `goalType`: `"distance" | "time" | "endurance"` (weight_loss 는 향후 확장)
  - `goalValue` 스키마:
    - `distance`: `null` (기존 `targetDistance`/`targetDate` 계속 사용, backward-compat)
    - `time`: `{ distance: "5K"|"10K"|"HM"|"FM", targetTimeSec: number, targetDate: "YYYY-MM-DD" }`
    - `endurance`: `{ targetLongRunKm: number, targetDate?: "YYYY-MM-DD" }`

- **F2 · Generator** — `plan-generator.ts` 가 `goalType` 별 progression 분기.
  - **time**: baseline avg pace vs target pace gap 계산. workout 별 target pace 를 baseline pace 에서 target pace 로 주차별 선형 개선.
    - 예: 10K 50:00 목표 (target pace 5:00/km), baseline 5:45/km → 주간 (5:45 - 5:00) / (weekCount - taperWeeks) 씩 개선
    - workout type 별 tempo/interval 우선 개선, easy/long 은 baseline 유지 (회복 보장)
  - **endurance**: peak long run 을 `targetLongRunKm` 로 설정. baseline long run (≈ Wk1 long slot) → target 을 주차별 선형 ramp. peak 주까지 도달, taper 주에는 감소. `PEAK_LONG_MIN_KM` 로직 대체.
  - **distance** (기존): 로직 유지 (`PEAK_LONG_MIN_KM[targetDistance]`, `TARGET_VOLUME_MULT` 그대로).

- **F3 · Validation** — MCP `generate_training_plan` 이 goalType 별 페이로드 검증.
  - time: `targetTimeSec` 정수, `distance` 5K/10K/HM/FM, `targetDate` 마지막 주 창 내 (F5 동일 규칙)
  - endurance: `targetLongRunKm` 1~50 범위, `targetDate` optional (있으면 마지막 주 창 내)

- **F4 · API Zod** — `/api/training-plan/generate` 에 `goalType`, `goalValue` 추가 (discriminated union).

- **F5 · UI** — `GeneratePlanForm` 에 goalType 셀렉터 (distance/time/endurance) + 유형별 파라미터 입력.
  - distance: 기존 targetDistance/targetDate 유지
  - time: distance + target time (분:초) + targetDate
  - endurance: target long run (km) + optional targetDate

- **F6 · MCP 응답** — `get_active_training_plan` 및 history/detail 응답에 `goalType`, `goalValue` 포함. 아카이브 리스트 뱃지, detail 페이지 stat 확장.

## 기술 설계

### time 목표 progression

```
paceGap = baselinePace - targetPace   // sec/km (양수: 개선 여지)
weeklyImprovement = paceGap / (weekCount - taperWeeks)   // 주간 감소량
weekTargetPace(w) = baselinePace - weeklyImprovement * (w + 1)  // Wk1 = baseline - Δ, ..., peakWk = targetPace
```

- **tempo/interval**: `weekTargetPace(w)` 기반 zone 페이스 (`paceZoneFor` 대체 로직)
- **easy/long**: baseline pace 유지 (회복/지구력 슬롯은 강도 안 올림, injury 방지)
- **taper 주**: 마지막 주 이전 로직과 무관 (rest / easy)
- **race day** (targetDate == workout date): rest

`goalValue.distance` 는 volume 스케일(`TARGET_VOLUME_MULT[distance]`)에 재사용.

### endurance 목표 progression

```
peakLongKm = targetLongRunKm
baselineLongKm = baselineWeeklyKm * (long slot volumeRatio × ratioNorm) // Wk1 long 값
weekLongKm(w) =
  w < growthWeeks
    ? baselineLongKm + (peakLongKm - baselineLongKm) * (w + 1) / growthWeeks
    : peakLongKm * taperMultipliers[w - growthWeeks]
```

- `PEAK_LONG_MIN_KM[targetDistance]` 승격 로직은 endurance 에서 무시 (사용자가 명시적 targetLongRunKm 지정)
- 나머지 workout slot (easy/tempo/interval/recovery) 는 기존 progression 로직 유지
- targetDate: 있으면 race taper window 적용 (기존 로직)

### distance 목표 (기존 유지)

로직 무변경. `goalType == "distance"` 인 경우 기존 code path 그대로.

### Schema migration

```sql
ALTER TABLE "TrainingPlan"
  ADD COLUMN "goalType" TEXT NOT NULL DEFAULT 'distance',
  ADD COLUMN "goalValue" JSONB;
```

기존 record: `goalType='distance'`, `goalValue=NULL`. `targetDistance`/`targetDate` 는 계속 유지 (distance 유형이 사용).

## 변경 파일

**신규**
- `prisma/migrations/<TS>_m11_training_plan_goal_type/migration.sql`
- `src/lib/training/goal-progression.ts` — time/endurance 별 workout distance/pace 계산 helper

**수정**
- `prisma/schema.prisma` — TrainingPlan.goalType, goalValue
- `src/lib/training/plan-generator.ts` — goalType 분기 (goal-progression 로 위임)
- `src/lib/training/plan-scaling.ts` — endurance 시 `PEAK_LONG_MIN_KM` skip
- `src/mcp/tools/training-plan.ts` — validation, DB 저장/반환
- `src/mcp/server.ts` — tool description 갱신
- `src/app/api/training-plan/generate/route.ts` — Zod discriminated union
- `src/app/training-plan/types.ts` — payload 확장
- `src/app/training-plan/components/GeneratePlanForm.tsx` — goalType 셀렉터 + 유형별 파라미터
- `src/app/training-plan/components/PlanCalendar.tsx` — goal 배지 문구 확장
- `src/app/training-plan/components/ArchivedList.tsx` — goal 뱃지
- `src/app/training-plan/history/[planId]/page.tsx` — goal stat
- `src/lib/training/plan-history.ts` / `plan-detail.ts` — goalType/goalValue 반환

## 테스트 계획

- **distance 회귀**: goalType 미지정 → DEFAULT `"distance"`, 결과가 v2.12.0 과 완전 동일
- **time**:
  - 10K sub-50 (300 sec/km) + baseline 345 sec/km + weekCount=8 → tempo/interval 페이스가 주차별로 45/7 ≈ 6.4 sec/km 씩 개선, peak 주 target 도달
  - baseline > target (이미 sub-goal 도달) → error 400 or 최소 개선 폭 0 처리
  - targetDate 마지막 주 창 밖 → 400 (Phase 1 규칙 재사용)
- **endurance**:
  - targetLongRunKm=25, baseline long=12 → 주차별 선형 증대, peak 주 25km, taper 감소
  - targetLongRunKm=50 → 400 (범위 초과)
- **UI**: 셀렉터 전환 시 유형별 필드만 표시, 유효성 즉시 표시

## 제외 (별도 이슈 / Phase)

- `weight_loss` 목표 유형 — 훈련 강도 조정 (kcal deficit 고려) 로직이 별개 → 별도 이슈
- 다중 목표 (`goalType` 배열) — M11 스펙상 Phase 4
- Phase 3 자동 조정 (readiness 연동) — 검토 단계
