# 마일스톤 6 — AI 깊이 강화 (장기 계획 + 부상 예방 + 레이스 목표)

- **시작**: 2026-06-30
- **테마**: M5 의 결정적 도구화를 한 단계 더 — AI 가 "지금" 평가뿐 아니라 **장기 추세/예측/계획**까지 결정적으로 산출. 사용자 가치: 코치 수준의 조언.
- **선행 의존**: M5 (MCP 도구 4종 + 프롬프트 캐싱 + 멀티턴) 모두 완료.

## 배경

M5 까지 AI 는 "오늘 회복 점수", "최근 7일 부하" 같은 **단기 평가**에 강함. 그러나 사용자(러닝 중심, 체중 감량 진행, 잠재 race 목표) 입장에서는 다음 단계 필요:
- "다음 4주 어떻게 훈련해야?"
- "부상 위험 있나? 언제부터 회복일?"
- "내 페이스로 5K/10K race 시 예상 기록?"
- "오늘 정확히 어떤 workout (거리/페이스/Zone)?"

이런 질문에 AI 가 매번 prompt + 일반론으로 답하는 게 아니라, **결정적 도구**로 산출하면 일관성 + 신뢰도 + 토큰 절약.

## 하위 태스크 (4개)

### M6-1: `generate_training_plan` MCP 도구 — 우선순위 ★★★

> 4주 cycle 훈련 계획 자동 생성. 사용자 목표 + 현재 피트니스 기반.

**산출**:
- 4주 일자별 권장 workout: 거리, 강도 (Zone), 유형 (easy/tempo/interval/long/rest)
- ACWR(M5-2-2) 점진적 증가 (10% 미만)
- 사용자 LTHR/maxHR (M4-1) 기반 Zone
- 주중 분포 (월/수/금 quality, 화/목/일 easy or rest, 토 long)

**입력**: 목표 거리 (5K/10K/HM/FM) optional, 목표 race date optional, 주간 가용 시간

**스펙**: `docs/specs/m6-1-training-plan.md` (별도)

### M6-2: `get_injury_risk_score` MCP 도구 — 우선순위 ★★★

> HRV 추세 + 누적 부하 + 수면 일관성 + 안정시 HR 패턴 → 부상/오버트레이닝 위험 점수.

**산출**:
- 0-100 risk score
- 4단계 라벨: `safe` / `caution` / `elevated` / `high`
- 기여 요인 (top 3 — 예: "HRV 14일 연속 하락", "ACWR 1.6 (high zone)")
- 권장 조치 (예: "내일 회복일 권장", "이번 주 강도 -20%")

**입력**: 없음 (현재 상태 평가)

**스펙**: `docs/specs/m6-2-injury-risk.md` (별도)

### M6-3: `get_race_prediction` MCP 도구 — 우선순위 ★★

> 동일 거리 활동 데이터 + 최근 트레이닝 트렌드 → 목표 거리 race 예상 기록.

**산출**:
- 목표 거리별 예측 (5K/10K/HM/FM): 최선 시나리오, 현실 시나리오, 최악 시나리오
- 신뢰도 점수 (데이터 충분도 기반)
- 도달 가능 예상일 (현재 추세 유지 시)

**입력**: `targetDistance` (선택, default 5K/10K/HM/FM 모두)

**기반**: M5-2-3 (pace progression) + Riegel formula 또는 Cameron formula (race 거리 예측 공식)

**스펙**: `docs/specs/m6-3-race-prediction.md` (별도)

### M6-4: `recommend_today_workout` MCP 도구 — 우선순위 ★★

> 오늘 readiness (M5-2-1) + 주간 트레이닝 계획 (M6-1) + 부상 위험 (M6-2) → 오늘 구체적 workout 추천.

**산출**:
- workout 유형 (easy/tempo/interval/long/rest)
- 거리 (km)
- 페이스 범위 (sec/km)
- Zone target
- 추천 이유 (1-2 문장)

**입력**: 없음 (오늘 평가)

**의존**: M6-1 (계획) + M6-2 (위험) + M5-2-1 (readiness). 통합 도구.

**스펙**: `docs/specs/m6-4-today-workout.md` (별도)

## 권장 진행 순서

```
M6-2 (부상 위험) — 빠른 승리, 기존 도구 (HRV, ACWR, restingHR) 조합
M6-3 (race 예측) — pace_progression 활용, Riegel 공식 단순
M6-1 (트레이닝 계획) — 복잡도 높음, 새 DB 모델 (TrainingPlan) 필요
M6-4 (오늘 workout) — M6-1 ~ M6-3 의존
```

## 제외 사항

- 트레이닝 계획 UI (캘린더 뷰) — 별도 마일스톤 후보 (UX 강화 시점)
- 부상 이력 추적 (사용자가 직접 입력) — 별도 backlog
- 다른 wearable 연동 (Apple Watch, Fitbit) — 별도 마일스톤
- 외부 race API (race 일정 검색) — 별도 backlog

## 성공 기준

- M6-1: 모닝 리포트에서 "오늘 권장 workout" 이 일관된 계획 기반 (지난 4주 / 다음 4주 맥락 포함)
- M6-2: 모닝/이브닝 리포트에 부상 위험 점수 자동 포함
- M6-3: 사용자 질문 "10K 자체 best 페이스로 풀 마라톤 가능?" 같은 질문에 결정적 답변
- M6-4: 오늘 workout 추천이 매일 일관된 4주 계획 + 회복 상태 반영

## 후속 (M6 이후)

- M7 후보: UX 강화 (트레이닝 계획 UI 캘린더, 부상 위험 추세 차트)
- 또는: 영양소 상세 (M4-8) — MFP 연동 활성화 시점
