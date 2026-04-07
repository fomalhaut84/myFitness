# [Phase 1] 수동 싱크 API + 싱크 상태 관리

## 목적

웹에서 수동으로 Garmin 싱크를 트리거하고, 싱크 상태를 조회할 수 있는 API 구현.

## 요구사항

- [ ] `POST /api/sync` — 수동 싱크 트리거 (날짜 범위, 데이터 타입 선택 가능)
- [ ] `GET /api/sync/status` — 데이터 타입별 싱크 상태 조회
- [ ] 기본 동작: 최근 3일 싱크 (날짜 미지정 시)
- [ ] 응답에 싱크 결과 요약 포함

## 기술 설계

### POST /api/sync

```typescript
// Request body (모두 optional)
{
  startDate?: string,  // "2026-04-01" (미지정 시 3일 전)
  endDate?: string,    // "2026-04-07" (미지정 시 어제)
  dataTypes?: string[] // ["activities", "sleep"] (미지정 시 전체)
}

// Response
{
  results: [
    { dataType: "daily_stats", synced: 5 },
    { dataType: "activities", synced: 2, error?: "..." }
  ]
}
```

### GET /api/sync/status

```typescript
// Response
{
  data: [
    {
      dataType: "daily_stats",
      lastSyncAt: "2026-04-07T06:00:00Z",
      lastSyncDate: "2026-04-06",
      syncCount: 365,
      status: "idle"
    }
  ]
}
```

## 테스트 계획

- [ ] `curl -X POST localhost:3000/api/sync` → 싱크 실행 + 결과 반환
- [ ] `curl localhost:3000/api/sync/status` → 상태 조회
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과

## 제외 사항

- Cron 자동 싱크 (Phase 3)
- 싱크 진행률 실시간 표시 (Phase 2+)
