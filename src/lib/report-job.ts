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
 * 완벽한 상호 배제는 아님 (조회-생성 사이 race 가능). PM2 fork 단일 프로세스 + web 요청
 * 자체가 동기 진입이라 실사용상 충돌은 극히 낮음. cron 은 정해진 시각에 1회만 실행.
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

  const job = await prisma.reportJob.create({
    data: {
      category: params.category,
      reportDate: params.reportDate,
      force: params.force,
      status: "pending",
    },
  });
  return { job, created: true };
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
 * pm2 restart 등으로 orphan 된 running/pending job 을 failed 로 마킹.
 * 앱 부팅 시 1회 호출. runReportJob 은 프로세스가 죽으면 다시 실행 불가.
 */
export async function sweepOrphanedJobs(timeoutMs: number): Promise<number> {
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
