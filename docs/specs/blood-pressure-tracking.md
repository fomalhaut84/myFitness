# 혈압 트래킹 + 건강 지표 연계 분석

## 목적

혈압 추이를 주기별(일/주/월)로 모니터링하고, 수면·스트레스·바디배터리 등
건강 지표와의 상관관계를 시각화하여 혈압 관리에 활용.

## 데이터 소스

Garmin Connect 혈압 API:
- 엔드포인트: `/bloodpressure-service/bloodpressure/range/{start}/{end}?includeAll=true`
- 일별 요약: highSystolic/lowSystolic, highDiastolic/lowDiastolic, numOfMeasurements, category
- 개별 측정: systolic, diastolic, pulse, measurementTimestampLocal, sourceType, category

## 요구사항

### 데이터 수집
- [ ] BloodPressure 모델 (DB 스키마)
- [ ] syncBloodPressure fetcher + sync 파이프라인 등록
- [ ] 초기 365일 히스토리 로드

### UI (심박 페이지 확장)
- [ ] 혈압 추세 차트 (수축기/이완기 라인, 30일/90일 전환)
- [ ] 카테고리 분류 영역 표시 (정상/고정상/1단계/2단계 배경 밴드)
- [ ] 맥박(pulse) 추세 (선택)
- [ ] 상관관계 차트: 혈압 vs 수면점수, 혈압 vs 스트레스, 혈압 vs 바디배터리

### AI 연계
- [ ] MCP get_blood_pressure 도구 (기간별 조회)
- [ ] 시스템 프롬프트에 혈압 해석 가이드
- [ ] 모닝/주간 리포트에 혈압 추세 포함 + 경고 규칙

## 기술 설계

### 스키마

```prisma
model BloodPressure {
  id            String   @id @default(cuid())
  date          DateTime @unique           // 일별 (midnight)
  highSystolic  Int                         // 당일 최고 수축기
  lowSystolic   Int                         // 당일 최저 수축기
  highDiastolic Int                         // 당일 최고 이완기
  lowDiastolic  Int                         // 당일 최저 이완기
  avgPulse      Int?                        // 평균 맥박
  measureCount  Int      @default(1)        // 측정 횟수
  category      String?                     // NORMAL, HIGH_NORMAL, STAGE_1_HIGH, STAGE_2_HIGH
  measurements  Json?                       // 개별 측정값 배열 (rawData)
  rawData       Json?
  createdAt     DateTime @default(now())
}
```

### 카테고리 분류 (WHO/ESH 기준)

| 카테고리 | 수축기 | 이완기 | 색상 |
|---|---|---|---|
| 정상 (NORMAL) | <120 | <80 | 초록 |
| 고정상 (HIGH_NORMAL) | 120-129 | 80-84 | 노랑 |
| 1단계 고혈압 (STAGE_1_HIGH) | 130-139 | 85-89 | 주황 |
| 2단계 고혈압 (STAGE_2_HIGH) | ≥140 | ≥90 | 빨강 |

### 상관관계 분석

같은 날짜의 데이터를 조인하여 산점도/이중 축 차트:
- X축: 수면점수/스트레스/바디배터리  
- Y축: 수축기 혈압
- 추세선으로 상관 시각화

### 경고 규칙

- 7일 평균 수축기 ≥ 135 또는 이완기 ≥ 85 → "혈압 상승 추세" 경고
- 3일 연속 STAGE_2_HIGH → "고혈압 지속" 경고
- 전주 대비 평균 수축기 10+ 상승 → "급상승" 경고

## 테스트 계획
- [ ] 마이그레이션 성공
- [ ] 7일 혈압 데이터 싱크 확인
- [ ] 심박 페이지에 혈압 차트 렌더링
- [ ] 상관관계 차트 렌더링
- [ ] AI 리포트에 혈압 언급 확인
- [ ] lint + tsc + build 통과
