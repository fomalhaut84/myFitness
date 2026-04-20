# [Phase 3] Cron 자동 싱크

## 목적

매일 06:00 KST에 Garmin 데이터를 자동으로 싱크하는 cron 스케줄러 구현.
Next.js instrumentation hook으로 서버 시작 시 cron 등록.

## 요구사항

- [ ] node-cron으로 매일 06:00 KST 자동 싱크
- [ ] Next.js instrumentation hook으로 서버 시작 시 cron 등록
- [ ] 싱크 실행 중 중복 방지 (mutex guard)
- [ ] 싱크 결과 로깅
- [ ] .env로 cron 스케줄 설정 가능 (SYNC_CRON)

## 기술 설계

### instrumentation.ts

Next.js 14의 `instrumentation.ts`로 서버 시작 시 한 번만 실행.
`next.config.mjs`에 `instrumentationHook: true` 이미 설정됨.

### cron.ts

```typescript
// src/lib/cron.ts
import cron from "node-cron";
import { syncAll } from "@/lib/garmin/sync";

let isSyncing = false;

export function startCronJobs() {
  const schedule = process.env.SYNC_CRON ?? "0 6 * * *"; // 매일 06:00
  cron.schedule(schedule, async () => {
    if (isSyncing) return; // mutex
    isSyncing = true;
    try { await syncAll(); }
    finally { isSyncing = false; }
  }, { timezone: "Asia/Seoul" });
}
```

### 환경변수

```
SYNC_CRON="0 6 * * *"  # 기본: 매일 06:00 (KST)
```

## 테스트 계획

- [ ] `npm run dev` → 서버 시작 시 cron 등록 로그 확인
- [ ] SYNC_CRON을 짧은 간격으로 설정하여 자동 싱크 동작 확인
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과

## 제외 사항

- 일일 통계 대시보드 (이슈 #12)
- 생활 패턴 분석 (이슈 #13)
