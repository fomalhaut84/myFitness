import { askAdvisor, resetSession } from "@/lib/ai/claude-advisor";
import { syncAll } from "@/lib/garmin/sync";
import { daysAgoKST, todayKST, todayKSTString as kstDateStr } from "@/lib/garmin/utils";
import prisma from "@/lib/prisma";
// #444: 프롬프트 정본은 report-prompts.ts (vitest 가 도구 명시를 회귀 검사)
import { EVENING_PROMPT, MORNING_PROMPT } from "@/lib/report-prompts";
import {
  createOrGetReportJob,
  runReportJob,
  getReportJob,
  waitForJobCompletion,
} from "@/lib/report-job";
import type { ReportJob } from "@/generated/prisma/client";

/**
 * 리포트/조언 생성 전 최신 데이터 싱크. auto-adjust cron 도 재사용.
 * #256: notifyBot 이 있으면 Garmin 재인증 실패 자동 감지 → 관리자 alert.
 */
export async function preSyncForReport(
  options?: { notifyBot?: import("grammy").Bot },
): Promise<void> {
  try {
    console.log("[report] 리포트 전 데이터 싱크 시작");
    await syncAll({
      startDate: daysAgoKST(1),
      endDate: todayKST(),
      // PR #456 Codex P2: 모닝 프롬프트가 get_blood_pressure 를 요구하므로 혈압도 리포트 전 갱신 (없으면 마지막 정기 싱크 이후 측정이 빠진다)
      dataTypes: ["sleep", "daily_stats", "heart_rate", "activities", "blood_pressure"],
      notifyBot: options?.notifyBot,
    });
    console.log("[report] 리포트 전 데이터 싱크 완료");
  } catch (error) {
    console.warn("[report] 리포트 전 싱크 실패, 기존 데이터로 진행:", error);
  }
}

async function generateReport(
  category: string,
  prompt: string,
  force = false,
  reportDate?: string,
  notifyBot?: import("grammy").Bot,
): Promise<string> {
  const dateStr = kstDateStr();
  // reportDate 명시됐으면 그것 사용 (UI 재생성 버튼 등 자정 넘김 케이스).
  // 미명시면 KST today.
  const targetDate = reportDate ?? dateStr;

  // force가 아니면 기존 리포트 반환
  if (!force) {
    const existing = await prisma.aIAdvice.findFirst({
      where: { category, reportDate: targetDate },
    });
    if (existing) {
      console.log(`[${category}] ${targetDate} 이미 존재, 건너뜀`);
      return existing.response;
    }
  }

  console.log(`[${category}] preSync 시작 (target=${targetDate})`);
  // #256: notifyBot 전달 → Garmin 재인증 실패 시 관리자 alert (bot 있을 때만).
  await preSyncForReport({ notifyBot });
  console.log(`[${category}] preSync 완료, askAdvisor 시작`);

  // cron 채널은 단발 강제 — 매번 fresh 세션 (이전 호출 컨텍스트 오염 차단)
  const channel = `cron-${category.replace("_report", "")}`;
  resetSession(channel);
  // #197: minTurns=2 — num_turns 는 agentic round trip count 라 batched tool call 시
  // 정상 리포트도 num_turns=2 로 완료 가능. num_turns=1 만 확실한 hallucination
  // (tool 호출 없이 답변). 미달 시 자동 재시도 (askAdvisor 내부 처리).
  const { result } = await askAdvisor(prompt, { channel, minTurns: 2 });
  console.log(`[${category}] askAdvisor 완료 (length=${result?.length ?? 0})`);

  // 조용한 실패 차단: 빈 응답이면 명시적 throw → 호출자(cron)가 알아챔
  if (!result || result.trim().length === 0) {
    throw new Error(`askAdvisor returned empty response for ${category}`);
  }

  // 트랜잭션: 같은 reportDate의 기존 record 삭제 + 새 create.
  // force=false 케이스에서도 동일 트랜잭션 사용 (race condition 시 중복 방지).
  await prisma.$transaction([
    prisma.aIAdvice.deleteMany({ where: { category, reportDate: targetDate } }),
    prisma.aIAdvice.create({
      data: { category, reportDate: targetDate, prompt, response: result },
    }),
  ]);
  console.log(`[${category}] ${targetDate} ${force ? "재생성" : "생성"} 완료`);

  return result;
}

/**
 * M#191: job 큐 wrapper. web 은 fire-and-forget (background=true 로 즉시 jobId 반환).
 * cron 은 background=false 로 완료 대기 후 결과 반환.
 *
 * 이미 completed job 이 있으면 (force=false) 그 결과 재사용. force=true 는 항상 새 job.
 */
async function runReportViaJob(params: {
  category: string;
  prompt: string;
  force: boolean;
  reportDate: string;
  background: boolean;
  notifyBot?: import("grammy").Bot;
}): Promise<{ job: ReportJob; result: string | null }> {
  const { category, prompt, force, reportDate, background, notifyBot } = params;

  const { job, created } = await createOrGetReportJob({
    category,
    reportDate,
    force,
  });

  // 이미 running 이면 재실행 X. web 은 fire-and-forget (그대로 jobId 반환), cron 도 그대로 결과 조회.
  const shouldRun = created && job.status === "pending";

  if (shouldRun) {
    const runner = runReportJob(job.id, async () => {
      await generateReport(category, prompt, force, reportDate, notifyBot);
      const advice = await prisma.aIAdvice.findFirst({
        where: { category, reportDate },
        orderBy: { createdAt: "desc" },
      });
      return { adviceId: advice?.id ?? null };
    });
    if (background) {
      // fire-and-forget. rejection 은 runReportJob 이 자체 처리 (throw 안 함).
      void runner;
    } else {
      await runner;
    }
  } else if (!background && (job.status === "pending" || job.status === "running")) {
    // P1: cron 이 web 과 겹친 경우 — 완료까지 poll 대기 후 결과 반환. 대기 없이
    // null 반환하면 텔레그램 알림 누락 (하루치 손실).
    console.log(
      `[report] ${category} ${reportDate} 이미 진행중 (${job.status}) — 완료 대기`,
    );
    await waitForJobCompletion(job.id);
  }

  // 완료된 리포트 텍스트 조회 (background 라도 이미 completed 였다면 반환).
  const finalJob = background ? job : (await getReportJob(job.id)) ?? job;
  let result: string | null = null;
  if (finalJob.status === "completed") {
    const advice = await prisma.aIAdvice.findFirst({
      where: { category, reportDate },
      orderBy: { createdAt: "desc" },
    });
    result = advice?.response ?? null;
  }
  return { job: finalJob, result };
}

/**
 * Web POST /api/reports 용 — 즉시 jobId 반환 + 백그라운드 실행.
 */
export async function startReportJob(params: {
  type: "morning" | "evening";
  force: boolean;
  reportDate?: string;
}): Promise<ReportJob> {
  const category =
    params.type === "morning" ? "morning_report" : "evening_report";
  const prompt = params.type === "morning" ? MORNING_PROMPT : EVENING_PROMPT;
  const reportDate = params.reportDate ?? kstDateStr();
  const { job } = await runReportViaJob({
    category,
    prompt,
    force: params.force,
    reportDate,
    background: true,
  });
  return job;
}

/**
 * #200: result=null 시 finalJob.status/errorMessage 를 담아 실제 원인 노출.
 * 텔레그램/UI 에서 "record 부재" 대신 askAdvisor 실패 원인 확인 가능.
 */
function buildReportError(category: string, job: ReportJob): Error {
  const parts = [`${category} 실패 (job status=${job.status})`];
  if (job.errorMessage) parts.push(job.errorMessage);
  return new Error(parts.join(": "));
}

export async function generateMorningReport(
  force = false,
  reportDate?: string,
  options?: { notifyBot?: import("grammy").Bot },
): Promise<string> {
  const { result, job } = await runReportViaJob({
    category: "morning_report",
    prompt: MORNING_PROMPT,
    force,
    reportDate: reportDate ?? kstDateStr(),
    background: false,
    notifyBot: options?.notifyBot,
  });
  if (!result) throw buildReportError("morning_report", job);
  return result;
}

export async function generateEveningReport(
  force = false,
  reportDate?: string,
  options?: { notifyBot?: import("grammy").Bot },
): Promise<string> {
  const { result, job } = await runReportViaJob({
    category: "evening_report",
    prompt: EVENING_PROMPT,
    force,
    reportDate: reportDate ?? kstDateStr(),
    notifyBot: options?.notifyBot,
    background: false,
  });
  if (!result) throw buildReportError("evening_report", job);
  return result;
}
