# [M4-2] 칼로리 밸런스 필드 추가

## 목적

일일 섭취가능 칼로리와 실제 섭취를 비교하여 체중감량 진행도 시각화.

## 계산 방식

```
섭취가능 칼로리 = 목표 칼로리(targetCalories) + 활성 칼로리(activeCalories)
결손/잉여 = 섭취 - 섭취가능
```

- 목표 1890kcal, 활성 500kcal → 섭취가능 2390kcal
- 섭취 1640kcal → 결손 -750kcal (체중감량 페이스)

## 요구사항

- [ ] UserProfile.targetCalories 필드 (M4-1에 포함)
- [ ] DailySummary 확장:
  - `estimatedIntakeCalories Int?` — 섭취 칼로리 (FoodLog 합계 또는 MFP)
  - `availableCalories Int?` — 목표 + 활성
  - `calorieBalance Int?` — 섭취 - 섭취가능
- [ ] 계산 로직
  - DailySummary 싱크 후 availableCalories 자동 계산
  - FoodLog 추가/수정 시 estimatedIntakeCalories 재계산
  - calorieBalance 계산
- [ ] 대시보드/체중 페이지에 표시

## 기술 설계

### 스키마

```prisma
model DailySummary {
  // ... 기존 필드
  estimatedIntakeCalories Int?
  availableCalories       Int?
  calorieBalance          Int?  // 음수 = 결손 (감량), 양수 = 잉여
}
```

### 계산 헬퍼

```typescript
// src/lib/fitness/calorie-balance.ts
export async function recalculateCalorieBalance(dateStr: string) {
  const profile = await prisma.userProfile.findFirst();
  const target = profile?.targetCalories ?? 0;

  const summary = await prisma.dailySummary.findUnique({
    where: { date: parseKSTDate(dateStr) },
  });
  if (!summary) return;

  const available = target + (summary.activeCalories ?? 0);

  const foods = await prisma.foodLog.findMany({
    where: { date: { /* 해당 날짜 */ } },
  });
  const intake = foods.reduce((sum, f) => sum + (f.estimatedKcal ?? 0), 0);

  await prisma.dailySummary.update({
    where: { id: summary.id },
    data: {
      availableCalories: available,
      estimatedIntakeCalories: intake,
      calorieBalance: intake - available,
    },
  });
}
```

### 호출 지점
- daily-summary fetcher 완료 후
- FoodLog POST/DELETE 후
- 수동 재계산 API

## 테스트 계획
- [ ] 마이그레이션 성공
- [ ] 목표 + 활성 칼로리 자동 계산
- [ ] FoodLog 추가 시 밸런스 업데이트
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
