# [Phase 1] Garmin 데이터 싱크 엔진

## 목적

Garmin Connect에서 데이터를 가져와 DB에 저장하는 싱크 엔진 구현.
초기 365일 히스토리 로드와 증분 싱크를 모두 지원한다.

## 요구사항

- [ ] 데이터 타입별 fetcher (활동, 일별 요약, 수면, 심박, 체성분)
- [ ] 싱크 오케스트레이터 (전체 싱크 흐름 관리)
- [ ] API 호출 간 2초 딜레이 (rate limit 방지)
- [ ] SyncMetadata 추적 (타입별 마지막 싱크 날짜, 상태)
- [ ] 초기 로드: 365일 히스토리
- [ ] 증분 싱크: lastSyncDate 이후 ~ 어제까지
- [ ] upsert 패턴 (중복 방지)
- [ ] 데이터 타입별 독립 싱크 (하나 실패해도 나머지 진행)
- [ ] 싱크 테스트 스크립트

## 기술 설계

### 싱크 순서

1. DailySummary (가장 가벼움, 대시보드 즉시 활용)
2. Activity (핵심 운동 데이터)
3. SleepRecord (수면 분석)
4. HeartRateRecord (심박/HRV 트렌드)
5. BodyComposition (체중 측정, 빈도 낮음)

### fetcher 구조

```
src/lib/garmin/
├── client.ts          # (기존) 인증 + 클라이언트 래퍼
├── sync.ts            # 싱크 오케스트레이터
└── fetchers/
    ├── activities.ts
    ├── daily-summary.ts
    ├── sleep.ts
    ├── heart-rate.ts
    └── body-composition.ts
```

### 각 fetcher 패턴

```typescript
async function syncActivities(startDate: Date, endDate: Date): Promise<number>
// 1. Garmin API 호출 (날짜별 또는 페이지네이션)
// 2. 데이터 파싱 (Garmin 응답 → Prisma 모델)
// 3. upsert (garminId 또는 date 기준)
// 4. 건수 반환
```

### rate limit

- `delay(ms)` 유틸: 호출 간 2초 대기
- API 호출 단위로 적용 (날짜별 또는 페이지별)

### SyncMetadata 관리

- 싱크 시작: status → "syncing"
- 싱크 완료: status → "idle", lastSyncDate 업데이트, syncCount++
- 싱크 실패: status → "error", errorMessage 기록

## 테스트 계획

- [ ] `npx tsx scripts/sync-garmin.ts` → 전체 데이터 타입 싱크 실행
- [ ] DB에 데이터 적재 확인 (`npx prisma studio`)
- [ ] SyncMetadata 레코드 생성 확인
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과

## 제외 사항

- API route (이슈 #5)
- Cron 자동 싱크 (Phase 3, 이슈 #11)
