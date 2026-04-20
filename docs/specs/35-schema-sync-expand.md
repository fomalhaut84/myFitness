# [M2-1] DB 스키마 확장 + 싱크 fetcher 보강

## 목적

rawData에만 저장되던 Garmin 데이터를 DB 컬럼으로 추출하여 상세 페이지에서 활용.

## 요구사항

- [x] Activity 모델: 케이던스, 보폭, 수직진동, 지면접촉시간, 유산소/무산소 TE, 호흡수, 랩수, 스플릿
- [x] SleepRecord 모델: SpO2, 호흡수(평균/최저/최고), 수면 스트레스, 배터리 변화, 안정시 심박, 야간 HRV, 점수 세부
- [x] DailySummary 모델: SpO2(평균/최저), 호흡수, 스트레스 세부(고/중/저 분), 배터리 충전/소모
- [x] 각 fetcher에서 새 필드 추출 로직 추가

## 기술 설계

- Activity: `summaryDTO`에서 러닝 다이나믹스 추출, `splitSummaries` 배열 그대로 JSON 저장
- SleepRecord: `dailySleepDTO`에서 호흡수/스트레스 추출, `sleepScores` 세부를 JSON 객체로 저장
- DailySummary: 기존 `calendarDate` API 응답에서 SpO2, 스트레스 시간(초→분 변환) 추출
- Json nullable 필드는 `Prisma.DbNull` 사용 (null 직접 할당 불가)

## 테스트 결과

- [x] `npx prisma migrate dev` 성공
- [x] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
- [x] PR #36 머지 완료

## 후속 작업

- 전체 데이터 재싱크로 새 필드에 데이터 적재
