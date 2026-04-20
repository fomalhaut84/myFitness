# [Phase 1] DB 스키마 설계 + Prisma 마이그레이션

## 목적

Garmin 데이터 저장에 필요한 전체 DB 모델을 Prisma 스키마로 정의하고,
초기 마이그레이션을 생성한다.

## 요구사항

- [ ] UserProfile 모델 (사용자 기본 정보)
- [ ] SyncMetadata 모델 (Garmin 싱크 상태 추적)
- [ ] Activity 모델 (운동 기록, garminId 중복 방지)
- [ ] DailySummary 모델 (일별 걸음/칼로리/스트레스/바디배터리)
- [ ] SleepRecord 모델 (수면 단계별 기록)
- [ ] HeartRateRecord 모델 (안정시 심박/HRV)
- [ ] BodyComposition 모델 (체중/체지방)
- [ ] AIAdvice 모델 (AI 조언 이력)
- [ ] FoodLog 모델 (식단 기록, Phase 5용 선행 정의)
- [ ] 초기 마이그레이션 생성 + 적용
- [ ] Prisma generate 후 typecheck 통과

## 기술 설계

### 스키마 설계 원칙

1. **rawData Json?**: 모든 Garmin 데이터 모델에 원본 JSON 보존 필드
2. **중복 방지**: Activity는 `garminId @unique`, 일별 데이터는 `date @unique`
3. **upsert 패턴**: 싱크 시 insert or update on unique key
4. **Phase 5 선행**: FoodLog 모델을 미리 정의하되 Phase 5에서 활용

### 인덱스 전략

- Activity: `[activityType, startTime]`, `[startTime]`
- AIAdvice: `[category, createdAt]`
- FoodLog: `[date]`

## 테스트 계획

- [ ] `npx prisma migrate dev` 성공
- [ ] `npx prisma generate` 성공
- [ ] `npx tsc --noEmit` 통과
- [ ] `npm run build` 성공

## 제외 사항

- 시드 데이터 (Garmin 싱크로 데이터 입력, 이슈 #4)
- API routes (이슈 #5+)
