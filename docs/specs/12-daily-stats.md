# [Phase 3] 일일 통계 대시보드

## 목적

걸음 수, 칼로리, 스트레스, 바디배터리의 30일 추세를 시각화하는 대시보드 확장.
기존 대시보드 홈 하단에 추세 섹션 추가.

## 요구사항

- [ ] 걸음 수 30일 추세 (바 차트)
- [ ] 활동 칼로리 30일 추세 (바 차트)
- [ ] 평균 스트레스 30일 추세 (라인 차트)
- [ ] 바디배터리 30일 추세 (라인 차트, 최고/최저 범위)
- [ ] 각 추세에 기간 평균값 표시

## 기술 설계

대시보드 홈(`/`) 페이지에 "30일 추세" 섹션 추가.
기존 SSR 데이터 조회에 30일 DailySummary를 추가.

### 컴포넌트

```
src/components/dashboard/
├── (기존) SummaryCard.tsx
├── (기존) WeeklyChart.tsx
├── (기존) RecentActivities.tsx
└── DailyTrendSection.tsx   # 30일 추세 4개 차트 묶음
```

TrendLineChart (공용 컴포넌트)와 WeeklyChart를 재사용.

## 테스트 계획

- [ ] 대시보드에 30일 추세 섹션 표시
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
