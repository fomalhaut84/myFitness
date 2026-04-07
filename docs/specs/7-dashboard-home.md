# [Phase 2] 대시보드 홈

## 목적

오늘의 피트니스 핵심 지표를 한눈에 보여주는 대시보드 홈 페이지 구현.
DB에 저장된 Garmin 데이터를 조회하여 요약 카드와 주간 미니차트로 표시.

## 요구사항

- [ ] 오늘 요약 카드 (4개): 걸음 수, 안정시 심박, 수면 점수, 바디배터리
- [ ] 각 카드에 전일 대비 변화량 표시
- [ ] 주간 미니차트 (7일): 걸음 수 추세, 심박 추세
- [ ] 최근 활동 목록 (최근 5건)
- [ ] 데이터 없을 때 빈 상태(empty state) 표시
- [ ] API route: GET /api/dashboard

## 기술 설계

### API 응답 구조

```typescript
GET /api/dashboard
{
  today: {
    steps: number | null,
    restingHR: number | null,
    sleepScore: number | null,
    bodyBattery: number | null,
  },
  yesterday: { ... },  // 전일 대비용
  weeklySteps: { date: string, value: number }[],
  weeklyHR: { date: string, value: number }[],
  recentActivities: {
    id: string,
    name: string,
    activityType: string,
    startTime: string,
    duration: number,
    distance: number | null,
    avgPace: number | null,
  }[]
}
```

### 컴포넌트 구조

```
src/components/dashboard/
├── SummaryCard.tsx       # 요약 카드 (값 + 변화량)
├── WeeklyChart.tsx       # 주간 미니 바 차트
└── RecentActivities.tsx  # 최근 활동 목록
```

### 차트

Recharts 설치 후 미니 바 차트 사용. 7일 데이터, 높이 80px.

## 테스트 계획

- [ ] `curl localhost:3000/api/dashboard` → 데이터 반환 확인
- [ ] 대시보드 페이지 접속 → 카드 + 차트 + 활동 목록 표시
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
