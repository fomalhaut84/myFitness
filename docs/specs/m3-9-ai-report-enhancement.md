# [M3-9] AI 리포트 고도화

## 목적

식단·운동·수면을 통합 평가하고, 개인화된 Zone/칼로리 기반 피드백 제공.

의존: M3-1 (LTHR), M3-2 (칼로리 밸런스), M3-3 (식단), M3-5 (강도 분류), M3-8 (영양소)

## 요구사항

- [ ] 시스템 프롬프트에 사용자 프로필(maxHR, LTHR, targetCalories, targetWeight) 주입
- [ ] MCP 도구 응답에 Zone 정보 포함 (`get_activity` 등)
- [ ] 모닝 리포트: 칼로리 밸런스 + 근손실 위험 반영
- [ ] 이브닝 리포트: 당일 Zone 분포 + 영양소 평가
- [ ] 주간 리포트: 매크로 밸런스 주간 요약, 감량 페이스 평가
- [ ] 경고 규칙:
  - "결손 > 750kcal 3일 연속 + Z4+ 운동" → 오버트레이닝/근손실 경고
  - "단백질 < 1.2g/kg" → 단백질 보충 권장
  - "LTHR 도달 후 회복 부족" → 회복일 권장

## 기술 설계

### 시스템 프롬프트 섹션 추가

```
## 사용자 프로필
- 최대심박: {maxHR} bpm
- LTHR: {lthr} bpm, LTHR 페이스: {lthrPace}/km
- 목표 칼로리: {targetCalories} kcal/일
- 목표 체중: {targetWeight} kg ({targetDate}까지)

## 해석 가이드
- Zone 4 = {0.94×lthr}~{0.99×lthr} bpm, Zone 5 = >{lthr} bpm
- 결손 -500~-750kcal = 적정 감량 (주 0.5kg)
- 결손 < -1000kcal = 근손실 위험 (특히 고강도 운동 병행 시)
```

### 통합 평가 MCP 도구

```typescript
// src/mcp/tools/get-weight-loss-status.ts
{
  name: "get_weight_loss_status",
  description: "최근 7일 체중·칼로리·운동·단백질 통합 요약",
}
// 응답: { weightChange, avgDeficit, projectedLoss, proteinAvg, riskLevel, reasons[] }
```

## 테스트 계획

- [ ] 모닝 리포트 샘플 생성 → 개인 Zone 수치 반영 확인
- [ ] 근손실 위험 시나리오 → 경고 포함 확인
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과
