import { askAdvisor, resetSession } from "@/lib/ai/claude-advisor";
import { todayKSTString as kstDateStr } from "@/lib/garmin/utils";
import prisma from "@/lib/prisma";
import {
  createOrGetReportJob,
  runReportJob,
  getReportJob,
  waitForJobCompletion,
} from "@/lib/report-job";
import type { ReportJob } from "@/generated/prisma/client";

const WEEKLY_REPORT_PROMPT = `이번 주 피트니스 데이터를 종합 분석해서 주간 리포트를 작성해줘.

다음 항목을 포함해줘:
1. 주간 운동 요약 (러닝 횟수, 총 거리, 평균 페이스, 강도 분류별 횟수)
2. 수면 분석 (평균 수면 시간, 수면 점수 추세)
3. 심박/HRV 트렌드 (피로도 판단)
4. 컨디션 종합 평가 (바디배터리, 스트레스)
5. 칼로리 밸런스 주간 요약 (get_weight_loss_status로 조회):
   - 주간 평균 결손/잉여
   - 감량 페이스 평가 (적정/과도/부족)
   - 체중 변화 (7일 이동평균 기준)
6. 경고 사항 (시스템 프롬프트의 경고 규칙에 해당하면 반드시 포함)
7. 다음 주 추천 사항 (Zone 기반 훈련 배분 + 칼로리 밸런스 관리)

마크다운 형식으로 간결하게 작성해줘.`;

/** 실제 spawn + DB save. job 안에서 호출됨. */
async function generateAndSaveWeekly(reportDate: string): Promise<void> {
  resetSession("cron-weekly");
  // #197: minTurns=3 — 주간 리포트도 반드시 MCP 도구 조회 필요.
  const { result } = await askAdvisor(WEEKLY_REPORT_PROMPT, {
    channel: "cron-weekly",
    minTurns: 3,
  });
  if (!result || result.trim().length === 0) {
    throw new Error("weekly askAdvisor returned empty response");
  }
  // 트랜잭션: 같은 reportDate 기존 record 삭제 + 새 create (재생성 안전).
  await prisma.$transaction([
    prisma.aIAdvice.deleteMany({
      where: { category: "weekly_report", reportDate },
    }),
    prisma.aIAdvice.create({
      data: {
        category: "weekly_report",
        reportDate,
        prompt: WEEKLY_REPORT_PROMPT,
        response: result,
      },
    }),
  ]);
  console.log(`[weekly-report] ${reportDate} 생성 완료`);
}

async function runWeeklyViaJob(params: {
  force: boolean;
  reportDate: string;
  background: boolean;
}): Promise<{ job: ReportJob; result: string | null }> {
  const { force, reportDate, background } = params;
  const { job, created } = await createOrGetReportJob({
    category: "weekly_report",
    reportDate,
    force,
  });
  const shouldRun = created && job.status === "pending";
  if (shouldRun) {
    const runner = runReportJob(job.id, async () => {
      await generateAndSaveWeekly(reportDate);
      const advice = await prisma.aIAdvice.findFirst({
        where: { category: "weekly_report", reportDate },
        orderBy: { createdAt: "desc" },
      });
      return { adviceId: advice?.id ?? null };
    });
    if (background) void runner;
    else await runner;
  } else if (!background && (job.status === "pending" || job.status === "running")) {
    // P1: cron 이 web 과 겹친 경우 완료 대기.
    console.log(
      `[weekly-report] ${reportDate} 이미 진행중 (${job.status}) — 완료 대기`,
    );
    await waitForJobCompletion(job.id);
  }
  const finalJob = background ? job : (await getReportJob(job.id)) ?? job;
  let result: string | null = null;
  if (finalJob.status === "completed") {
    const advice = await prisma.aIAdvice.findFirst({
      where: { category: "weekly_report", reportDate },
      orderBy: { createdAt: "desc" },
    });
    result = advice?.response ?? null;
  }
  return { job: finalJob, result };
}

/** Web POST /api/reports 용. */
export async function startWeeklyReportJob(params: {
  force: boolean;
  reportDate?: string;
}): Promise<ReportJob> {
  const { job } = await runWeeklyViaJob({
    force: params.force,
    reportDate: params.reportDate ?? kstDateStr(),
    background: true,
  });
  return job;
}

/** cron / 완료 대기 흐름. */
export async function generateWeeklyReport(): Promise<string> {
  const { result } = await runWeeklyViaJob({
    force: false,
    reportDate: kstDateStr(),
    background: false,
  });
  if (!result) {
    throw new Error("weekly_report 결과 조회 실패 (job 완료 후 record 부재)");
  }
  return result;
}
