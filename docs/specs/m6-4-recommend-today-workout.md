# M6-4: `recommend_today_workout` MCP 도구

- **작성일**: 2026-07-01
- **타입**: feature (P1)
- **마일스톤**: M6 (`docs/specs/m6-overview.md`)
- **백엔드 전용** (read-only, DB 변경 없음)

## 1. 목적

`get_active_training_plan` (M6-1) + `get_readiness_score` (M5-2-1) + `get_injury_risk_score` (M6-2) 을 결정적으로 통합하여 **오늘 실제로 뛸 workout** 을 단일 응답으로 제안. AI 가 여러 도구를 조합해 규칙을 재발명하지 않도록 통합 로직을 서버측에 위치.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 신규 read-only MCP 도구 `recommend_today_workout`. 입력 없음.
- [ ] **F2**: Base workout 결정
  - active plan 이 있고 오늘 workout row 존재 → 그것을 base 로 사용 (`source: "plan"`)
  - active plan 이 없거나 오늘 rest 로 계획됨 → fallback 규칙 (`source: "fallback"`):
    - `type = "easy"`, `distanceKm = baselineWeeklyKm × 0.2` (기본 easy 배분), pace/zone = LTHR × 1.20 (Z2)
    - baseline 은 M6-1 computeBaseline 재사용 (최근 28일 총 km / 4, 저볼륨 fallback 15 km/wk)
- [ ] **F3**: 조정 매트릭스 (base → recommended)

  | injury \ readiness | optimal | good | moderate | fatigued | depleted |
  |---|---|---|---|---|---|
  | safe     | keep | keep | keep | downgrade1 | rest |
  | caution  | keep | keep | downgrade1 | downgrade1 | rest |
  | elevated | downgrade1 | downgrade1 | downgrade2 | rest | rest |
  | high     | rest | rest | rest | rest | rest |

  - **downgrade ladder** (한 단계씩): `interval → tempo → easy → recovery → rest`
  - `long` 은 downgrade 시 `easy` (distance × 0.6 축소)
  - `rest` 는 downgrade 결과 유지
- [ ] **F4**: Pace range 계산 — 조정된 workout 의 target pace 를 중심으로 ±5 % 범위 (min, max). rest 는 pace 없음.
- [ ] **F5**: 한국어 rationale (1~2문장)
  - 예: "readiness 45 (fatigued) + 부상 위험 42 (elevated) → 계획된 tempo 를 easy 로 완화."
  - 예: "readiness 88 (good) + 부상 위험 낮음 (safe) → 계획대로 진행."
  - readiness/injury score 부재 시 "회복/부상 지표 부족 → 계획 그대로" 처럼 명시.
- [ ] **F6**: 응답 스키마 compact JSON (M6-1/3 학습)

### 2.2 비기능

- KST 기준. DB write 없음.
- 응답 토큰 ≤ 500.
- 각 종속 도구 호출은 병렬 (`Promise.all`).

## 3. 기술 설계

### 3.1 조정 로직 (플로우)

```
1. base = plan.todayWorkout ?? fallback()
2. injuryLabel = injury.label (또는 null → safe 로 간주)
3. readinessLabel = readiness.label (또는 null → moderate 로 간주)
4. downgradeSteps = matrix[injuryLabel][readinessLabel]  // 0 | 1 | 2 | "rest"
5. recommended = applyDowngrade(base, downgradeSteps)
6. paceRange = recommended.pace 있으면 ±5%
7. rationale = compose(readinessLabel, injuryLabel, base.type, recommended.type)
```

### 3.2 데이터 소스 재사용

- `getActiveTrainingPlan()` 응답 파싱 → today 매칭 workout (없을 수도 있음)
- `getReadinessScore()` → `score`, `label`
- `getInjuryRiskScore()` → `score`, `label`
- fallback 시 M6-1 `computeBaseline` + `paceZoneFor` 재사용

MCP 도구 payload 는 `content[0].text` 에 JSON. 각 도구를 직접 import 하여 함수 호출 후 JSON.parse.

### 3.3 응답 스키마

```jsonc
{
  "date": "2026-07-01",
  "base": {
    "source": "plan",          // "plan" | "fallback"
    "type": "tempo",
    "distanceKm": 6.5,
    "pace": "4:59",
    "zone": "Z3-4",
    "planId": "clx..."         // source: "plan" 일 때만
  },
  "recommendation": {
    "type": "easy",
    "distanceKm": 6.5,
    "paceRange": { "min": "5:25", "max": "5:59" },
    "zone": "Z2",
    "intervalDesc": null,
    "adjusted": true,
    "adjustmentReason": "fatigue + elevated injury risk"
  },
  "factors": {
    "readiness": { "score": 45, "label": "fatigued" },
    "injury":    { "score": 42, "label": "elevated" },
    "plan":      { "hasActivePlan": true, "todayIsRestPlanned": false }
  },
  "rationale": "readiness 45 (fatigued) + 부상 위험 42 (elevated) → tempo 를 easy 로 완화."
}
```

## 4. 변경 파일

- `src/lib/training/workout-recommender.ts` *(신규, 조정 매트릭스 + downgrade + pace range + rationale)*
- `src/mcp/tools/recommend-today-workout.ts` *(신규, 도구 wrapper)*
- `src/mcp/server.ts` — 도구 등록
- `src/lib/ai/claude-advisor.ts` — allowedTools 에 추가 (**read-only 라 자동 승인 안전**)

## 5. 테스트 계획

`npm run lint && npm run typecheck && npm run build` 3종.

수동 확인:
1. active plan 없는 상태에서 호출 → fallback easy workout.
2. active plan 있고 오늘 tempo 계획 + readiness "fatigued" → easy 로 downgrade 확인.
3. injury "high" → rest 강제.

## 6. 제외 사항

- 자동 사용자 알림 / 리마인더 (별도)
- Race prediction (M6-3) 통합 — 오늘 workout 결정에는 불필요
- 사용자 선호도 오버라이드 (`preferLong`, `avoidInterval` 등) — 후속

## 7. 롤백

`git revert`. DB / env 영향 없음.
