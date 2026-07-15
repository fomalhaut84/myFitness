# [feat] Training Plan — weight_loss 목표 유형 (M11 Phase 2-b)

- **작성일**: 2026-07-15
- **이슈**: #236 (예정)
- **선행**: [#232 (Phase 2: time+endurance)](./232-training-plan-goal-type.md), [#222 (Phase 1: weekCount)](./222-training-plan-week-count.md)
- **범위**: `goalType = "weight_loss"` 도입. UserProfile 필드 (`targetWeight`, `targetDate`, `targetCalories`) 재사용 + 사용자 선택 강도 재조정 모드.

## 목적

M11 Phase 2 (#232) 로 time / endurance 목표를 도입했지만, "체중 감량과 병행" 시나리오는 여전히 미지원. 감량 중에는 kcal deficit 상태라 회복 지연/부상 위험이 커서 훈련 강도를 재조정할 필요가 있다. 사용자가 감량 페이스와 훈련 강도 균형을 스스로 선택할 수 있게 한다.

## 요구사항

- **F1**: goalType 확장 — `TrainingPlan.goalType` enum 에 `"weight_loss"` 추가 (기존 컬럼 재사용, 값만 확장). Schema migration 없음 (String 컬럼).
- **F2**: goalValue 페이로드 — `{ intensityMode: "light" | "standard" | "intense" }`. UserProfile 의 targetWeight/targetDate/targetCalories 는 참조만, goalValue 에 중복 저장 안 함.
- **F3**: UserProfile pre-check — plan 생성 시 UserProfile.targetWeight 가 설정되어 있어야 함 (없으면 400 오류 + "설정에서 목표 체중을 먼저 지정하세요" 안내).
- **F4**: Generator intensityMode 별 재조정 로직 — `plan-generator.ts` 에서 goalType==="weight_loss" 브랜치.
  - **light**: 전 주간 볼륨 -20% (multipliers × 0.8). 강도(interval/tempo) 유지. 짧은 세션 = 회복/diet 시간 확보.
  - **standard**: 볼륨 유지. interval slot → easy 로 downgrade (5x 패턴에만 있음). 강도 완화 = 회복 여유. kcal 소모는 계속 진행.
  - **intense**: 조정 없음. 감량은 순수 diet 로, 훈련은 원 로직 유지. base plan 과 동일 결과.
- **F5**: MCP tool validation — goalType==="weight_loss" 시 `goalValue.intensityMode` 필수, 3-way enum 검증.
- **F6**: API Zod 확장 — weightLossGoal 페이로드 추가.
- **F7**: UI — `GeneratePlanForm` goalType 셀렉터 4-way (distance / time / endurance / weight_loss). weight_loss 선택 시 intensityMode 라디오 + UserProfile targetWeight 표시 (설정 안 되어 있으면 링크 안내).
- **F8**: 응답 확장 — MCP `get_active_training_plan` / history / detail 에 goalType=weight_loss + goalValue 포함 (기존 flow 그대로 재사용).

## 기술 설계

### intensityMode 별 workout override

`generatePlan` 함수 workout loop 내에서 goalType==="weight_loss" 브랜치 추가:

```
if (goalType === "weight_loss") {
  const mode = weightLossGoal.intensityMode;
  if (mode === "light") {
    workoutKm *= 0.8;  // 볼륨 -20%
  } else if (mode === "standard") {
    if (slot.type === "interval") {
      // interval → easy 치환. slot.type 을 override, pace/zone 도 easy 기준으로.
      slotType = "easy";
    }
  }
  // intense: 아무 것도 안 함
}
```

**주의사항**:
- 볼륨 -20% 는 race taper window (raceTaperFactor) 와 곱하기 순서 필요. race taper 가 우선 적용 후 -20% (또는 그 반대).
- interval → easy 치환 시 `intervalDesc` 는 null, notes 도 easy 텍스트, paceZoneFor("easy") 호출.
- distance/time 목표의 PEAK_LONG_MIN_KM 승격은 weight_loss 에서 skip (감량 중 무리한 long run 강제 X).

### UserProfile pre-check

`generateTrainingPlan` MCP tool 초입에 profile 조회 시:

```
if (goalType === "weight_loss") {
  const profile = await prisma.userProfile.findFirst({ select: { targetWeight: true } });
  if (!profile?.targetWeight) {
    throw new Error("weight_loss 목표는 UserProfile.targetWeight 가 먼저 설정되어야 합니다. /settings/profile 에서 지정하세요.");
  }
}
```

기존 lthrPace 조회와 동일 트랜잭션 flow. 사용자 오류로 400 반환 (isUserInputError 매칭).

### 데이터 흐름

- goalValue DB 저장: `{ intensityMode: "standard" }` (짧음, JSON 컬럼)
- MCP 응답 payload: goalValue 그대로 노출 → UI 배너에서 렌더

## 변경 파일

**수정**
- `src/lib/training/goal-progression.ts` — validateWeightLossGoal + IntensityMode enum export
- `src/lib/training/plan-generator.ts` — goalType==="weight_loss" 브랜치 (volume ×0.8 or interval→easy)
- `src/mcp/tools/training-plan.ts` — validation, UserProfile pre-check, weightLossGoal 파싱, DB 저장
- `src/mcp/server.ts` — tool description + Zod schema 확장
- `src/app/api/training-plan/generate/route.ts` — Zod weightLossGoal 필드
- `src/app/training-plan/types.ts` — GoalType 확장 + WeightLossGoalPayload
- `src/app/training-plan/components/GeneratePlanForm.tsx` — 4-way selector + intensityMode 라디오
- `src/app/training-plan/components/PlanCalendar.tsx` — renderGoalBanner 확장
- `src/app/training-plan/components/ArchivedList.tsx` — renderGoalBadge 확장

**신규 없음** — 기존 goal-progression.ts 에 helper 추가만.

## 테스트 계획

- **회귀**: distance/time/endurance 3 유형 결과가 v2.13.0 과 완전 동일 (goalType==="weight_loss" 아니면 code path 무변경).
- **light**: 4주, baseline 20km/wk, intensityMode="light" → 전 주간 workout km 이 정확히 기존 × 0.8.
- **standard**: 5x 패턴 (interval 있음), intensityMode="standard" → interval slot 이 easy 로 치환, distanceKm 유지, paceSecPerKm 는 easy zone.
- **intense**: intensityMode="intense" → distance 목표 (targetDistance/targetDate 없이) 와 동일 결과 (control).
- **UserProfile 없음**: targetWeight null 상태에서 goalType="weight_loss" 요청 → 400 + "설정에서 목표 체중을 먼저 지정하세요".
- **UI**: goalType=weight_loss 선택 시 intensityMode 3 라디오 노출, UserProfile.targetWeight 표시.

## 제외 (별도 이슈 / Phase)

- **kcal deficit 자동 계산**: targetCalories vs 실제 소모 비교 → 훈련 강도 자동 조정. Phase 3 (readiness 연동) 로 미룸.
- **다중 목표** (weight_loss + time 동시): M11 Phase 4.
- **감량 완료 후 automatic goalType 전환**: 검토 안 함.
