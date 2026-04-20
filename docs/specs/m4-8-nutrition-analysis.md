# [M4-8] 영양소 상세 분석

## 목적

단백질/탄수화물/지방 일일 추적 + 매크로 밸런스 시각화 + 근손실 방지 경고.

의존: M4-3 (식단 데이터 연동)

## 요구사항

- [ ] DailyNutrition (또는 FoodLog 합계) 기반 매크로 일별/주별 집계
- [ ] 단백질 목표 대비 추적 (체중 기준 1.6g/kg 권장)
- [ ] 매크로 밸런스 도넛 차트 (P/C/F 비율)
- [ ] 근손실 위험 경고 로직
  - 조건: 칼로리 결손 > 500kcal + 단백질 < 1.6g/kg + 고강도 운동(Z4+ > 30분/주)
  - 대시보드 배너 + AI 리포트 반영
- [ ] `/nutrition` 페이지 또는 `/weight-loss` 탭

## 기술 설계

### 목표치 설정

```prisma
model UserProfile {
  // ...
  proteinTargetPerKg Float? @default(1.6) // g/kg bodyweight
}
```

### 근손실 위험 평가

```typescript
// src/lib/fitness/muscle-loss-risk.ts
export function assessMuscleLossRisk(input: {
  weeklyCalorieDeficit: number; // avg kcal/day
  avgProteinPerKg: number; // g/kg
  weeklyHighIntensityMin: number; // Z4+ minutes
}): { risk: "low" | "medium" | "high"; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (input.weeklyCalorieDeficit > 500) {
    score++;
    reasons.push(`일평균 결손 ${input.weeklyCalorieDeficit}kcal (>500)`);
  }
  if (input.avgProteinPerKg < 1.6) {
    score++;
    reasons.push(`단백질 ${input.avgProteinPerKg}g/kg (<1.6 권장)`);
  }
  if (input.weeklyHighIntensityMin > 30) {
    score++;
    reasons.push(`고강도 운동 주 ${input.weeklyHighIntensityMin}분 (>30)`);
  }

  const risk = score >= 3 ? "high" : score >= 2 ? "medium" : "low";
  return { risk, reasons };
}
```

### AI 프롬프트 연동

리포트 생성 시 위험 평가 결과를 주입:
```
[근손실 위험: HIGH]
- 일평균 결손 750kcal
- 단백질 1.2g/kg
- 고강도 주 45분
→ 리포트에 경고와 권장사항 포함
```

## 테스트 계획

- [ ] 위험 평가 로직 단위 테스트 (3가지 조건 조합)
- [ ] 매크로 차트 렌더링
- [ ] AI 리포트에 경고 반영 확인
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과
