import { EventEmitter } from "node:events";
import type { ReportJob } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { getAskAdvisorMaxTotalBudgetMs } from "@/lib/ai/claude-advisor";

// #244 Codex P2: askAdvisor 실제 소요 시간 (env ASK_ADVISOR_MAX_RETRIES 반영) 기반으로
// waiter / orphan 예산을 dynamic 계산 → env override 시에도 정합.
// preSync (~60s) + waiter 여유 (100s) → 총 buffer 160s.
const PRESYNC_BUFFER_MS = 60_000;
const WAIT_BUFFER_MS = 100_000;
const TOTAL_BUFFER_MS = PRESYNC_BUFFER_MS + WAIT_BUFFER_MS;

/**
 * M#191: 리포트 생성 비동기 job 인프라.
 *
 * - createOrGetReportJob: 중복 방지 (같은 category+reportDate 로 pending/running 있으면 그 job 반환).
 * - runReportJob: 백그라운드 실행. status 전이 + EventEmitter 로 SSE 브릿지.
 * - subscribeToJob: SSE endpoint 가 사용. 이벤트 수신 → 클라이언트 push.
 * - sweepOrphanedJobs: 앱 부팅 시 orphan 을 failed 로 마킹.
 *   pending / running 별 cutoff 분리 (pending 은 짧게, running 은 dynamic).
 *
 * Process-local EventEmitter — pm2 fork 단일 프로세스에서 SSE endpoint 와 runner 가 같은 프로세스라 정합.
 */

export type JobStatus = "pending" | "running" | "completed" | "failed";

export type JobEvent =
  | { type: "status"; status: JobStatus }
  | { type: "completed"; adviceId: string | null }
  | { type: "failed"; errorMessage: string };

const jobBus = new EventEmitter();
// listener 상한 완화 — 동일 job 에 다중 탭/재방문으로 다수 subscriber 붙을 수 있음.
jobBus.setMaxListeners(100);

function emit(jobId: string, event: JobEvent): void {
  jobBus.emit(jobId, event);
}

/** SSE endpoint 가 호출. 반환된 cleanup 을 stream close 시 실행. */
export function subscribeToJob(
  jobId: string,
  onEvent: (event: JobEvent) => void,
): () => void {
  jobBus.on(jobId, onEvent);
  return () => {
    jobBus.off(jobId, onEvent);
  };
}

/**
 * 동일 category+reportDate 로 pending/running job 있으면 그것 반환, 없으면 신규 pending 생성.
 *
 * DB level partial unique index (`ReportJob_active_unique`) 로 race 차단:
 * pending/running 상태에서 동일 (category, reportDate) 는 1건만 허용.
 * 두 프로세스 (web + bot) 가 동시 create 시도해도 두 번째는 P2002 위반 → catch 후 재조회.
 */
export async function createOrGetReportJob(params: {
  category: string;
  reportDate: string;
  force: boolean;
}): Promise<{ job: ReportJob; created: boolean }> {
  const existing = await prisma.reportJob.findFirst({
    where: {
      category: params.category,
      reportDate: params.reportDate,
      status: { in: ["pending", "running"] },
    },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return { job: existing, created: false };

  try {
    const job = await prisma.reportJob.create({
      data: {
        category: params.category,
        reportDate: params.reportDate,
        force: params.force,
        status: "pending",
      },
    });
    return { job, created: true };
  } catch (err) {
    // Race: 다른 프로세스가 그 사이 create → partial unique index 위반 (P2002).
    // 재조회로 승자 반환.
    const isUniqueViolation =
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "P2002";
    if (!isUniqueViolation) throw err;
    // P2#4: force=false + 기존 AIAdvice 있는 경우 runner 가 즉시 completed 로 전이 가능
    // (generateReport 초기 check). active_only 필터로 못 찾을 수 있음 → status 무관하게
    // 가장 최근 job 반환. completed 면 호출자가 그 결과 사용.
    const winner = await prisma.reportJob.findFirst({
      where: {
        category: params.category,
        reportDate: params.reportDate,
      },
      orderBy: { startedAt: "desc" },
    });
    if (!winner) {
      throw new Error(
        "createOrGetReportJob: unique violation but no job found",
      );
    }
    return { job: winner, created: false };
  }
}

/**
 * runner 가 정상 실행 중임을 sweeper 에 알리는 heartbeat 간격.
 * ORPHAN_TIMEOUT_MS 대비 충분히 짧아야 정상 실행 중 job 이 orphan 처리 안 됨.
 */
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * pending job 을 running 으로 전이 후 generator 실행.
 * 완료 시 completed + adviceId 저장, 실패 시 failed + errorMessage 저장.
 * 이 함수는 fire-and-forget 으로 호출되므로 throw 하지 않고 이벤트만 emit.
 *
 * P2#5: 실행 중 heartbeat 로 updatedAt 갱신 → sweeper 가 정상 job 을 orphan 오판 안 함.
 */
export async function runReportJob(
  jobId: string,
  generator: () => Promise<{ adviceId: string | null }>,
): Promise<void> {
  let heartbeatTimer: NodeJS.Timeout | null = null;
  try {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: { status: "running" },
    });
    emit(jobId, { type: "status", status: "running" });

    // Heartbeat: updatedAt 을 명시적으로 갱신. Prisma 는 empty update ({data: {}}) 시
    // @updatedAt 을 갱신 안 하므로 (docs: prisma-schema-reference#updatedat), 반드시
    // updatedAt: new Date() 를 넣어야 sweeper 가 healthy 로 인식.
    // 5분 sweep cutoff vs 30s 간격 → 10배 여유. 30s 안에 프로세스가 죽지 않는 한 orphan 오판 없음.
    heartbeatTimer = setInterval(() => {
      prisma.reportJob
        .update({
          where: { id: jobId },
          data: { updatedAt: new Date() },
        })
        .catch((err) => {
          console.error(`[report-job] ${jobId} heartbeat failed:`, err);
        });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();

    const { adviceId } = await generator();

    await prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        completedAt: new Date(),
        adviceId,
      },
    });
    emit(jobId, { type: "status", status: "completed" });
    emit(jobId, { type: "completed", adviceId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[report-job] ${jobId} failed:`, errorMessage);
    await prisma.reportJob
      .update({
        where: { id: jobId },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage,
        },
      })
      .catch((updateErr) => {
        console.error(
          `[report-job] ${jobId} status=failed 저장 실패:`,
          updateErr,
        );
      });
    emit(jobId, { type: "status", status: "failed" });
    emit(jobId, { type: "failed", errorMessage });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

export async function getReportJob(jobId: string): Promise<ReportJob | null> {
  return prisma.reportJob.findUnique({ where: { id: jobId } });
}

/**
 * cron 이 web 과 동시 실행 시나리오 방어. 이미 running job 은 완료 대기.
 * TimeoutMs 초과 시 마지막 스냅샷 반환 (호출자가 null result 로 처리).
 *
 * 예산: askAdvisor 실제 max budget × (1 + MAX_RETRIES) + preSync + 여유.
 * env ASK_ADVISOR_MAX_RETRIES=5 (상한) 시 자동으로 1240s (약 20분) 로 확장 →
 * 소비자가 override 안 해도 정합 (Codex bot P2 PR #247 재리뷰).
 */
export async function waitForJobCompletion(
  jobId: string,
  timeoutMs = getAskAdvisorMaxTotalBudgetMs() + TOTAL_BUFFER_MS,
  pollIntervalMs = 2000,
): Promise<ReportJob | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await prisma.reportJob.findUnique({ where: { id: jobId } });
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return prisma.reportJob.findUnique({ where: { id: jobId } });
}

/**
 * category+reportDate 로 최신 pending/running job 조회. 프론트 mount 시 재개용.
 */
export async function getActiveReportJob(params: {
  category: string;
  reportDate: string;
}): Promise<ReportJob | null> {
  return prisma.reportJob.findFirst({
    where: {
      category: params.category,
      reportDate: params.reportDate,
      status: { in: ["pending", "running"] },
    },
    orderBy: { startedAt: "desc" },
  });
}

/**
 * running orphan cutoff: askAdvisor 실제 max budget × (1 + MAX_RETRIES) + preSync 여유.
 * env 반영 dynamic 계산. MAX_RETRIES=2 default → 700s (약 12분). env 상한 (5) 시 자동 20분.
 * 정상 실행 중 job (heartbeat 갱신됨) 은 안전, pm2 restart 등으로 heartbeat 끊긴 것만 처리.
 */
export const ORPHAN_TIMEOUT_MS =
  getAskAdvisorMaxTotalBudgetMs() + TOTAL_BUFFER_MS;

/**
 * pending orphan cutoff: createOrGetReportJob 로 pending row 만 만든 뒤 runReportJob 시작
 * 전에 프로세스가 죽으면 heartbeat 도 못 켬. 이후 호출이 이 pending 을 찾으면 replacement
 * 안 만들어 category+date 리포트 생성이 stuck (Codex bot P2 PR #247 재리뷰).
 * pending 은 heartbeat 필요 없으므로 5분 cutoff 로 충분 (짧게 유지해 복구 창 최소화).
 */
export const PENDING_ORPHAN_TIMEOUT_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * pm2 restart 등으로 orphan 된 pending/running job 을 failed 로 마킹.
 * 부팅 1회 + periodic (5분 주기) 두 방식 병행.
 *
 * status 별 cutoff 분리:
 *   - running: ORPHAN_TIMEOUT_MS (heartbeat 갱신되어야 안전)
 *   - pending: PENDING_ORPHAN_TIMEOUT_MS (짧게, 실행 시작 전 crash 케이스 빠른 복구)
 *
 * updatedAt 기준 판정. runner heartbeat 이 30s 마다 touch 하므로 정상 running job 안전.
 */
export async function sweepOrphanedJobs(
  runningTimeoutMs: number = ORPHAN_TIMEOUT_MS,
  pendingTimeoutMs: number = PENDING_ORPHAN_TIMEOUT_MS,
): Promise<number> {
  const now = Date.now();
  const runningCutoff = new Date(now - runningTimeoutMs);
  const pendingCutoff = new Date(now - pendingTimeoutMs);
  const result = await prisma.reportJob.updateMany({
    where: {
      OR: [
        { status: "running", updatedAt: { lt: runningCutoff } },
        { status: "pending", updatedAt: { lt: pendingCutoff } },
      ],
    },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorMessage: "orphaned by process restart",
    },
  });
  if (result.count > 0) {
    console.log(
      `[report-job] swept ${result.count} orphaned job(s) (running_cutoff=${runningTimeoutMs}ms pending_cutoff=${pendingTimeoutMs}ms)`,
    );
  }
  return result.count;
}

/**
 * Periodic sweep. 앱 부팅 시 1회 호출. 반환된 stop 함수는 SIGTERM 등에서 정리용.
 * setInterval 은 unref 로 이벤트 루프 blocker 방지.
 */
export function startOrphanSweeper(): () => void {
  const timer = setInterval(() => {
    sweepOrphanedJobs().catch((err) => {
      console.error("[report-job] periodic sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
