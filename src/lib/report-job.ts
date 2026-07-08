import { EventEmitter } from "node:events";
import type { ReportJob } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

/**
 * M#191: 리포트 생성 비동기 job 인프라.
 *
 * - createOrGetReportJob: 중복 방지 (같은 category+reportDate 로 pending/running 있으면 그 job 반환).
 * - runReportJob: 백그라운드 실행. status 전이 + EventEmitter 로 SSE 브릿지.
 * - subscribeToJob: SSE endpoint 가 사용. 이벤트 수신 → 클라이언트 push.
 * - sweepOrphanedJobs: 앱 부팅 시 orphan (pm2 restart 중 running 이었던 job) 을 failed 로 마킹.
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
    const winner = await prisma.reportJob.findFirst({
      where: {
        category: params.category,
        reportDate: params.reportDate,
        status: { in: ["pending", "running"] },
      },
      orderBy: { startedAt: "desc" },
    });
    if (!winner) {
      // 극단 케이스: unique violation 발생 후 상태 전이가 매우 빨라 조회 시점엔 completed.
      // 재조회 후에도 없으면 completed 인 최근 job 을 반환하지 않고 에러.
      throw new Error(
        "createOrGetReportJob: unique violation but no active job found",
      );
    }
    return { job: winner, created: false };
  }
}

/**
 * pending job 을 running 으로 전이 후 generator 실행.
 * 완료 시 completed + adviceId 저장, 실패 시 failed + errorMessage 저장.
 * 이 함수는 fire-and-forget 으로 호출되므로 throw 하지 않고 이벤트만 emit.
 */
export async function runReportJob(
  jobId: string,
  generator: () => Promise<{ adviceId: string | null }>,
): Promise<void> {
  try {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: { status: "running" },
    });
    emit(jobId, { type: "status", status: "running" });

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
    // update 실패도 조용히 넘기지 않음 — 사이드채널 로그만 남기고 원 에러 이벤트는 emit.
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
  }
}

export async function getReportJob(jobId: string): Promise<ReportJob | null> {
  return prisma.reportJob.findUnique({ where: { id: jobId } });
}

/**
 * cron 이 web 과 동시 실행 시나리오 방어. 이미 running job 은 완료 대기.
 * TimeoutMs 초과 시 마지막 스냅샷 반환 (호출자가 null result 로 처리).
 * askAdvisor TIMEOUT_MS (180s) + preSync headroom → 기본 240s.
 */
export async function waitForJobCompletion(
  jobId: string,
  timeoutMs = 240_000,
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
 * askAdvisor 최대 실행 시간 (180s) + preSync 여유. 이 시간 초과된 pending/running
 * job 은 orphan 으로 간주 후 failed 마킹.
 * askAdvisor TIMEOUT_MS = 180s 이라 5분 (300s) cutoff 은 정상 완료 job 을 잘못
 * 죽이지 않으면서 pm2 restart 로 orphan 된 job 은 빠르게 감지.
 */
export const ORPHAN_TIMEOUT_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * pm2 restart 등으로 orphan 된 running/pending job 을 failed 로 마킹.
 * 부팅 1회 + periodic (5분 주기) 두 방식 병행.
 */
export async function sweepOrphanedJobs(
  timeoutMs: number = ORPHAN_TIMEOUT_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);
  const result = await prisma.reportJob.updateMany({
    where: {
      status: { in: ["pending", "running"] },
      startedAt: { lt: cutoff },
    },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorMessage: "orphaned by process restart",
    },
  });
  if (result.count > 0) {
    console.log(
      `[report-job] swept ${result.count} orphaned job(s) (timeout=${timeoutMs}ms)`,
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
