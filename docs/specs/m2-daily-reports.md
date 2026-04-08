# [M2] 시간대별 AI 리포트 + 지표 평가 보완

## 목적

시간에 따라 변하는 지표(바디배터리 등)의 평가 일관성을 확보하기 위해
하루 2회(모닝/이브닝) 정기 AI 리포트를 생성하고 DB에 기록한다.
또한 MCP 도구와 시스템 프롬프트를 보완하여 실시간 AI 질문에서도
시간대 바이어스 없이 정확한 판단이 가능하도록 한다.

## 요구사항

- [ ] AIAdvice 스키마에 reportDate 필드 추가
- [ ] 모닝 리포트 (08:00 KST): 수면 분석, 회복 상태, 운동 추천
- [ ] 이브닝 리포트 (23:00 KST): 하루 활동 정리, 회복 필요성, 내일 계획
- [ ] MCP 도구 응답에 시간대 맥락 데이터 포함 (바이어스 방지)
- [ ] 시스템 프롬프트에 시간대별 지표 해석 가이드 추가
- [ ] Cron 스케줄 추가 (모닝 08:00, 이브닝 23:00)
- [ ] Reports API 확장 (type/date 필터, 수동 생성)
- [ ] 대시보드 상단 오늘 리포트 요약 카드
- [ ] /reports 페이지 신규 (이력 + 수동 생성)
- [ ] 사이드바에 리포트 링크 추가

## 기술 설계

### MCP 도구 응답 맥락 보강 (바이어스 방지)

`get_daily_stats` 응답에 해석 맥락을 추가하여 AI가 현재값만 보고 오판하지 않도록 함:

```json
{
  "date": "2026-04-08",
  "bodyBattery": 15,
  "bodyBatteryHigh": 65,
  "bodyBatteryLow": 12,
  "bodyBatteryCharged": 40,
  "bodyBatteryDrained": 45,
  "_context": {
    "bodyBattery": "현재값(15)은 하루 중 자연 소모 결과. 기상 시 충전값(65)과 충전량(40)/소모량(45)으로 판단할 것. 저녁에 낮은 값은 정상 패턴.",
    "stress": "avgStress(33)는 하루 평균. 운동 중 고스트레스는 정상이므로 휴식 중 스트레스 비율(restStressPercentage)로 실제 스트레스 수준 판단.",
    "restingHR": "주간 측정값은 활동 영향을 받음. 수면 중 측정값(SleepRecord.restingHR)이 더 정확.",
    "spo2": "주간 SpO2는 측정 환경에 따라 변동. 수면 중 SpO2가 기준값."
  }
}
```

`get_sleep` 응답에도 맥락 추가:
```json
{
  "_context": {
    "bodyBatteryChange": "수면 중 충전량(25). 30+ 이면 양호한 회복, 20 미만이면 회복 부족.",
    "hrvOvernight": "야간 HRV가 개인 기준선 대비 높으면 회복 양호, 낮으면 피로 누적."
  }
}
```

### 시스템 프롬프트 보강

```
## 지표 해석 시 시간대 고려 (필수)

아래 규칙을 반드시 따르세요. 현재값만으로 판단하면 시간대에 따라 평가가 달라지는 오류가 발생합니다.

### 바디배터리
- 기상 시(bodyBatteryHigh)를 컨디션 기준으로 사용하세요.
- bodyBattery(현재값)는 하루 중 자연 감소하므로 저녁에 낮은 것은 정상입니다.
- 컨디션 판단: bodyBatteryHigh 기준 (70+ 양호, 40-70 보통, 40 미만 피로)
- 회복 판단: bodyBatteryCharged (충전량) 기준 (40+ 양호한 회복)
- 소모 판단: bodyBatteryDrained (소모량)이 충전량보다 크면 오버페이스

### 안정시 심박
- 수면 중 측정값(SleepRecord.restingHR)이 가장 정확합니다.
- DailySummary.restingHR은 주간 활동 영향을 받으므로 참고용입니다.
- 추세가 중요: 7일 평균 대비 5bpm 이상 상승 시 피로/질병 의심

### 스트레스
- avgStress는 하루 평균이므로 운동 포함 시 높을 수 있습니다.
- 실제 스트레스 수준: 휴식 중 스트레스(stressLowDuration 비율)로 판단
- 운동 중 고스트레스는 정상 — 문제되는 것은 휴식 중 고스트레스

### SpO2
- 수면 중 SpO2(SleepRecord.avgSpO2)가 기준값입니다.
- 주간 SpO2는 측정 환경에 따라 변동이 크므로 참고용
- 95% 이상 정상, 90% 미만 주의 필요

### HRV
- 야간 HRV(SleepRecord.hrvOvernight)가 정확한 지표입니다.
- 절대값보다 7일 추세가 중요 (하락 추세 = 피로 누적)
```

### 모닝 리포트 프롬프트
수면 점수, 단계별 시간, SpO2, 호흡수, HRV, 기상 시 바디배터리(bodyBatteryHigh),
안정시 심박(수면 중), 오늘 운동 추천

### 이브닝 리포트 프롬프트
오늘 운동 기록, 걸음 수, 활동 칼로리, 스트레스 분포,
바디배터리 소모량(bodyBatteryDrained) vs 충전량(bodyBatteryCharged),
취침 전 회복 필요성, 내일 운동 계획

## 테스트 계획

- [ ] MCP get_daily_stats 응답에 _context 포함 확인
- [ ] AI 어드바이저에게 저녁에 "컨디션 체크" 질문 → 바디배터리 현재값이 아닌 기상 시 값 기준 평가
- [ ] 모닝/이브닝 리포트 수동 생성 확인
- [ ] 리포트 API 필터 동작 확인
- [ ] 대시보드에서 오늘 리포트 표시 확인
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
