# [M2-3] 활동 상세 페이지 강화

## 목적

M2-1에서 추가한 러닝 다이나믹스, 스플릿, TE 등의 데이터를 활동 상세에 시각화.

## 요구사항

- [ ] 킬로미터 스플릿 테이블 (km별 페이스, HR, 고도, 케이던스)
- [ ] 스플릿 페이스 바 차트 (느린 구간 빨강, 빠른 구간 초록)
- [ ] 러닝 다이나믹스 섹션 (케이던스, 보폭, 수직진동, 지면접촉시간)
- [ ] 유산소/무산소 TE, 호흡수 표시
- [ ] AI 평가 버튼 (해당 활동 데이터 기반 한줄 평가)

## 기술 설계

### 수정 파일
- `src/app/activities/[id]/page.tsx` — 확장 필드 조회
- `src/components/activity/ActivityDetail.tsx` — 러닝 다이나믹스 + TE 카드
- `src/components/activity/SplitChart.tsx` — 스플릿 바 차트 (신규)
- `src/components/activity/SplitTable.tsx` — 스플릿 테이블 (신규)

### 스플릿 데이터 구조 (splitSummaries JSON)
```json
[{
  "distance": 1000, "duration": 420, "movingDuration": 418,
  "elevationGain": 5, "averageSpeed": 2.38, "averageHR": 155,
  "maxHR": 165, "averageRunCadence": 172, "splitType": "INTERVAL_ACTIVE"
}]
```

## 테스트 계획
- [ ] 러닝 활동 상세 → 스플릿 테이블 + 차트 표시
- [ ] 스플릿 없는 활동 → 섹션 숨김
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
