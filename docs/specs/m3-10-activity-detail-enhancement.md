# [M3-10] 활동 상세 페이지 고도화

## 목적

활동 상세(`/activities/[id]`)에 Zone 분포·러닝 다이나믹스 그래프·스플릿 시각화 강화.

의존: M3-4 (splits MCP 선행 시 데이터 캐싱 재사용), M3-5 (Zone 분포 데이터)

## 요구사항

- [ ] HR Zone 분포 도넛/스택바 차트 (M3-5의 zoneDistribution 사용)
- [ ] km별 페이스 + HR 라인 오버레이 차트 (M2-7 바 차트 확장)
- [ ] 러닝 다이나믹스 시계열 그래프
  - 케이던스, 수직진동, 지면접촉시간, 보폭
  - Activity rawData 또는 details API에서 시계열 조회
- [ ] 강도 라벨 배지 ("threshold run", "interval", "recovery")
- [ ] 이전 동일 유형 활동과 비교 (평균 페이스·HR 델타)

## 기술 설계

### 데이터 소스

- 기존: Activity 테이블 + `/api/activities/[id]/splits`
- 신규: `/api/activities/[id]/timeseries` (상세 시계열 조회)
  - 캐싱: 최초 조회 시 Garmin API 호출 → Activity.rawData 또는 별도 테이블 저장

### 차트 구성

```
상단: 요약 카드 + 강도 배지
중단 좌: km 페이스+HR 오버레이
중단 우: Zone 분포 도넛 (z1~z5 %)
하단: 러닝 다이나믹스 시계열 (케이던스/수직진동/지면접촉시간 탭)
최하단: AI 평가 + 이전 활동 대비 비교
```

### 이전 활동 비교

```typescript
// 같은 activityType + distance ±10% 범위 내 최근 3개 활동
const similar = await prisma.activity.findMany({
  where: {
    type: current.type,
    distance: { gte: current.distance * 0.9, lte: current.distance * 1.1 },
    startTime: { lt: current.startTime },
  },
  orderBy: { startTime: "desc" },
  take: 3,
});
// avgPace/avgHR 델타 계산
```

## 테스트 계획

- [ ] Zone 도넛 렌더링 (M3-5 데이터 필요)
- [ ] 시계열 차트 모바일 반응형
- [ ] 비교 데이터 없을 때 빈 상태 UI
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과
