# M#191: 리포트 생성 비동기 job + SSE

- **작성일**: 2026-07-08
- **타입**: feature
- **이슈**: #191

## 1. 배경

웹에서 리포트 생성/재생성 도중 페이지 이탈 시 실패 처리. 리포트가 만들어질 때도 있고 아닐 때도 있음 (race).

원인: `POST /api/reports` 가 request-scoped 동기 실행. 클라이언트 fetch abort → Next.js API handler 종료 시나리오에서 spawn 도 kill 되거나 응답 실패로 UI 반영 안 됨.

## 2. 목표

리포트 생성을 백그라운드 job 으로 전환. 페이지 이탈 후 재방문 시 이어서 진행 상황 확인.

## 3. 요구사항

- [ ] **F1**: `ReportJob` 테이블 신설 (Prisma).
- [ ] **F2**: `POST /api/reports` 즉시 `{ jobId, status }` 반환, 백그라운드 spawn.
- [ ] **F3**: 동일 category+reportDate 로 pending/running 있으면 그 jobId 반환 (중복 방지).
- [ ] **F4**: `GET /api/reports/stream?jobId=...` SSE endpoint. 진행 상태 실시간 push.
- [ ] **F5**: `GET /api/reports/current-job?category=...&reportDate=...` — 진행중 job 조회 (mount 시 재개).
- [ ] **F6**: 프론트 EventSource 훅. 이탈 시 close (백엔드 무관 유지).
- [ ] **F7**: cron 도 job 큐 통합.
- [ ] **F8**: orphaned running job 자동 failed 마킹 (앱 시작 시 timeout sweeper).

## 4. 기술 설계

### 4.1 Prisma Schema

```prisma
model ReportJob {
  id            String    @id @default(cuid())
  category      String    // morning_report / evening_report / weekly_report
  reportDate    String    // YYYY-MM-DD
  status        String    @default("pending") // pending | running | completed | failed
  force         Boolean   @default(false)
  startedAt     DateTime  @default(now())
  completedAt   DateTime?
  errorMessage  String?
  adviceId      String?
  @@index([category, reportDate, status])
  @@index([status, startedAt])
}
```

### 4.2 파일 구조

**신규**:
- `src/lib/report-job.ts` — job 관리 + EventEmitter
- `src/app/api/reports/stream/route.ts` — SSE endpoint
- `src/app/api/reports/current-job/route.ts` — 진행중 job 조회
- `src/hooks/useReportJob.ts` — 프론트 SSE hook

**수정**:
- `prisma/schema.prisma` — ReportJob 모델
- `src/app/api/reports/route.ts` — POST 흐름 재구성
- `src/lib/daily-report.ts` / `src/lib/weekly-report.ts` — job 큐 wrapper
- `src/lib/cron.ts` — job 큐 통합
- 리포트 페이지 컴포넌트 (`src/app/(...)`) — EventSource 훅 사용

### 4.3 report-job.ts 인터페이스

```typescript
import { EventEmitter } from "node:events";

export type JobStatus = "pending" | "running" | "completed" | "failed";
export type JobEvent =
  | { type: "status"; status: JobStatus }
  | { type: "completed"; adviceId: string }
  | { type: "failed"; errorMessage: string };

/** 프로세스 로컬 이벤트 버스. SSE 브릿지. */
const jobBus = new EventEmitter();

/**
 * category+reportDate 에 pending/running job 있으면 그것 반환,
 * 없으면 새로 pending 생성.
 */
export async function createOrGetReportJob(params: {
  category: string;
  reportDate: string;
  force: boolean;
}): Promise<ReportJob>;

/**
 * job 을 status="running" 으로 update 후 generator 호출.
 * 완료 시 status="completed" + adviceId 저장, emit "completed".
 * 실패 시 status="failed" + errorMessage 저장, emit "failed".
 */
export async function runReportJob(
  jobId: string,
  generator: () => Promise<{ result: string; adviceId: string }>
): Promise<void>;

/** SSE subscribe. cleanup 함수 반환. */
export function subscribeToJob(
  jobId: string,
  onEvent: (event: JobEvent) => void
): () => void;

/** 오래된 running job 을 failed 로 sweep. 앱 시작 시 1회 호출. */
export async function sweepOrphanedJobs(timeoutMs: number): Promise<number>;
```

### 4.4 SSE 응답 형식

```
event: status
data: {"status":"running"}

event: completed
data: {"adviceId":"cuid..."}
```

Client `EventSource` 로 구독. `completed` 나 `failed` 후 close.

### 4.5 크래시 복구

앱 부팅 시 (`src/lib/cron.ts` init 이나 별도 booter):
```typescript
await sweepOrphanedJobs(10 * 60 * 1000); // 10분 이상 running → orphaned
```

pm2 restart 로 orphaned 된 job 은 UI 에서 실패로 표시. 사용자가 다시 생성 버튼 클릭 가능.

### 4.6 프론트 hook

```typescript
export function useReportJob(category: string, reportDate: string) {
  const [job, setJob] = useState<ReportJob | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);

  useEffect(() => {
    // mount 시 진행중 job 조회 → SSE 연결
    // 이탈 시 EventSource close
  }, [category, reportDate]);

  const trigger = async (force: boolean) => {
    // POST → jobId 받음 → SSE 연결
  };

  return { job, status, trigger };
}
```

## 5. 동시성

- **PM2 fork 단일 process**: EventEmitter process-local 이라 정합.
- **DB unique 제약** 대신 조회 후 create (트랜잭션 안). 상호 배제는 `createOrGetReportJob` 에서 `status IN (pending, running)` 조회 → 있으면 그것 반환.
- **다중 탭 동시 클릭**: 첫 번째만 생성, 두 번째부터 같은 jobId 반환. 둘 다 SSE 로 구독.

## 6. 테스트 계획

- E2E: 재생성 버튼 → 이탈 → 재방문 → 진행 상태 표시 재개 → 완료 확인
- 동시성: 다중 탭 재생성 → 하나만 실행 확인
- cron: 스케줄 실행 시 job 레코드 생성 확인 → 웹 UI 에서 이력 확인
- 크래시: pm2 restart 중 job → orphaned 마킹 확인
- 회귀: 기존 API 호환 유지 (`GET /api/reports` 조회 그대로)

## 7. 배포

- **Prisma migration 필요**: `npx prisma migrate deploy` 자동 실행 (deploy.sh 4단계)
- SSE 는 nginx 에서 buffering off 필요 확인 (`proxy_buffering off; proxy_cache off;`)

## 8. 제외 사항

- 일관성 부족 (LLM stochastic) — 별도 이슈 (미생성)
- Redis / 외부 job queue — 채택 안 함 (in-process 충분)
- WebSocket / long polling — SSE 로 통일

## 9. 롤백

- Migration revert (down.sql): `DROP TABLE "ReportJob"`
- POST /api/reports 흐름 되돌리기 (git revert)
- SSE endpoint 제거
