# [M3-6] 체중감량 진행 대시보드

## 목적

체중·칼로리 밸런스·운동량을 한 페이지에 모아 감량 진행도를 한눈에 확인.

의존: M3-2 (칼로리 밸런스 필드), M3-3 (식단 데이터) 권장

## 요구사항

- [ ] 신규 페이지 `/weight-loss` (기존 `/body` 확장도 고려)
- [ ] 체중 7/14/30일 이동평균 차트
- [ ] 칼로리 밸런스 일별 바 차트 (섭취 vs 섭취가능, 결손 하이라이트)
- [ ] 주간 요약 카드: 평균 결손, 예상 감량(kcal/7700), 실제 감량
- [ ] 운동량 추세 (주간 거리·활성칼로리)
- [ ] 목표 대비 진행도 (목표 체중/기간 설정 UI)

## 기술 설계

### 데이터 소스

- BodyComposition.weight (체중)
- DailySummary.calorieBalance / activeCalories / estimatedIntakeCalories
- Activity (distance 합계)
- UserProfile.targetWeight, targetDate (신규 필드)

### UserProfile 추가 필드

```prisma
model UserProfile {
  // ... M3-1, M3-2에서 추가된 필드
  targetWeight Float?   // kg
  targetDate   DateTime?
}
```

### 이동평균 계산

```typescript
// src/lib/fitness/weight-trend.ts
export function movingAverage(
  records: { date: Date; weight: number }[],
  window: number
): { date: Date; avg: number }[] {
  const sorted = [...records].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
  return sorted.map((_, i) => {
    const slice = sorted.slice(Math.max(0, i - window + 1), i + 1);
    const avg = slice.reduce((s, r) => s + r.weight, 0) / slice.length;
    return { date: sorted[i].date, avg: Number(avg.toFixed(2)) };
  });
}

export function projectWeightLoss(
  weeklyAvgDeficit: number // kcal/day
): number {
  // 체지방 1kg ≈ 7700 kcal
  return (weeklyAvgDeficit * 7) / 7700;
}
```

### 페이지 구성

```
/weight-loss
├── 상단 요약 카드 (현재 체중, 목표까지 X kg, ETA)
├── 체중 추세 차트 (raw + 7일 이동평균)
├── 칼로리 밸런스 차트 (bar: 섭취, line: 섭취가능, 음수 결손 빨강)
├── 주간 통계 테이블 (주별 평균 결손, 예상/실제 감량)
└── 운동량 추세 (주간 거리 바 차트)
```

## 테스트 계획

- [ ] 모바일/데스크톱 레이아웃 확인
- [ ] 데이터 없을 때 빈 상태 UI
- [ ] 이동평균 계산 정확도
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과

## 제외 사항

- 체지방률 트래킹 (M3-7)
- 영양소 매크로 밸런스 (M3-8)
