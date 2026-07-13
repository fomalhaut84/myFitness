import { askAdvisor, resetSession } from "@/lib/ai/claude-advisor";
import { syncAll } from "@/lib/garmin/sync";
import {
  todayKSTString as kstDateStr,
  daysAgoKST,
  todayKST,
} from "@/lib/garmin/utils";
import prisma from "@/lib/prisma";
import {
  createOrGetReportJob,
  runReportJob,
  getReportJob,
  waitForJobCompletion,
} from "@/lib/report-job";
import type { ReportJob } from "@/generated/prisma/client";

/**
 * #203: Sonnet 이 tool 호출 skip 하지 않도록 필요한 MCP 도구를 명시적으로 나열.
 * Daily prompt 와 비교해 자연어 지시만 있어 Sonnet 이 "기억으로 답변 가능" 이라
 * 오판하는 것으로 추정 → 도구 이름 + 인자 명시로 필수 호출 유도.
 */
const WEEKLY_REPORT_PROMPT = `이번 주 피트니스 데이터를 종합 분석해서 주간 리포트를 작성해줘.

## 반드시 아래 MCP 도구를 먼저 호출해 최신 데이터를 수집한 후 리포트 작성

- mcp__myfitness__get_activities(days=7, type="running") — 러닝 활동 목록
- mcp__myfitness__get_sleep(days=7) — 수면 추세 (점수, 시간)
- mcp__myfitness__get_heart_rate(days=7) — 심박/HRV 추세
- mcp__myfitness__get_daily_stats(days=7) — 걸음, 활동 칼로리, 스트레스
- mcp__myfitness__get_trends(period="week") — 전반 트렌드
- mcp__myfitness__get_training_load_trend() — 훈련 부하 추세
- mcp__myfitness__get_weight_loss_status() — 칼로리 밸런스 주간 요약
- mcp__myfitness__get_pace_progression() — 페이스 발전 추세
- mcp__myfitness__get_injury_risk_score() — 부상 위험도
- mcp__myfitness__get_blood_pressure(days=7) — 혈압 (시스템 프롬프트 주간 BP 경고 규칙 필수)

기억이나 추측이 아닌 위 도구 결과의 실제 수치만 인용.

## 리포트 항목 (마크다운, 간결하게)

1. 주간 운동 요약 (러닝 횟수, 총 거리, 평균 페이스, 강도 분류별 횟수)
2. 수면 분석 (평균 수면 시간, 수면 점수 추세)
3. 심박/HRV 트렌드 (피로도 판단)
4. 컨디션 종합 평가 (바디배터리, 스트레스)
5. 칼로리 밸런스 주간 요약: 평균 결손/잉여, 감량 페이스 평가, 체중 변화 (7일 이동평균)
6. 경고 사항 (시스템 프롬프트의 경고 규칙에 해당하면 반드시 포함)
7. 다음 주 추천 사항 (Zone 기반 훈련 배분 + 칼로리 밸런스 관리)`;

/**
 * #203: 주간 리포트 전 7일 데이터 sync. daily-report preSync (1일) 와 별개.
 * Prompt 필수 도구 목록과 대응해야 함:
 * - sleep/daily_stats/heart_rate/activities: 기본 (daily 와 동일)
 * - blood_pressure: get_blood_pressure(days=7) 대응 (Codex bot P2)
 * - body_composition: get_weight_loss_status 가 참조하는 체중 데이터 (Codex bot P2)
 */
async function preSyncForWeekly(): Promise<void> {
  try {
    console.log("[weekly-report] 7일 데이터 싱크 시작");
    await syncAll({
      startDate: daysAgoKST(7),
      endDate: todayKST(),
      dataTypes: [
        "sleep",
        "daily_stats",
        "heart_rate",
        "activities",
        "blood_pressure",
        "body_composition",
      ],
    });
    console.log("[weekly-report] 7일 데이터 싱크 완료");
  } catch (error) {
    console.warn(
      "[weekly-report] 데이터 싱크 실패, 기존 데이터로 진행:",
      error,
    );
  }
}

/** 실제 spawn + DB save. job 안에서 호출됨. */
async function generateAndSaveWeekly(reportDate: string): Promise<void> {
  // #203: 최신 7일 데이터 sync (daily-report preSync 와 대칭).
  await preSyncForWeekly();
  resetSession("cron-weekly");
  // #197: minTurns=2 — num_turns 는 agentic round trip 이라 batched 시 2 로 완료 가능.
  // num_turns=1 만 확실한 hallucination (tool 없이 답변).
  const { result } = await askAdvisor(WEEKLY_REPORT_PROMPT, {
    channel: "cron-weekly",
    minTurns: 2,
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
  const { result, job } = await runWeeklyViaJob({
    force: false,
    reportDate: kstDateStr(),
    background: false,
  });
  if (!result) {
    // #200: finalJob.errorMessage 를 담아 실제 원인 노출.
    const parts = [`weekly_report 실패 (job status=${job.status})`];
    if (job.errorMessage) parts.push(job.errorMessage);
    throw new Error(parts.join(": "));
  }
  return result;
}
