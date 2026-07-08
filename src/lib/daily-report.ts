import { askAdvisor, resetSession } from "@/lib/ai/claude-advisor";
import { syncAll } from "@/lib/garmin/sync";
import { daysAgoKST, todayKST, todayKSTString as kstDateStr } from "@/lib/garmin/utils";
import prisma from "@/lib/prisma";
import {
  createOrGetReportJob,
  runReportJob,
  getReportJob,
  waitForJobCompletion,
} from "@/lib/report-job";
import type { ReportJob } from "@/generated/prisma/client";

const MORNING_PROMPT = `모닝 리포트를 작성해줘.

어젯밤 수면 데이터와 현재 회복 상태를 분석하고, 감량 진행도를 포함해줘:
- 수면 점수, 수면 단계별 시간 (깊은/얕은/REM/깨어남)
- SpO2, 호흡수, 야간 HRV
- 기상 시 바디배터리 (bodyBatteryHigh 기준)
- 수면 중 안정시 심박수
- 바디배터리 충전량으로 회복 상태 평가
- 어제 칼로리 밸런스 (get_weight_loss_status 도구로 조회): 결손/잉여 평가 + 주간 추세
- 체중 추세: 최근 7일 변화, 감량 페이스가 적정(주 0.5kg)인지
- 오늘의 운동 추천 (회복 상태 + 칼로리 밸런스 고려, Zone 기반 강도 제안)
- 경고 규칙에 해당하면 반드시 경고 포함

간결한 마크다운으로 작성.`;

const EVENING_PROMPT = `이브닝 리포트를 작성해줘.

오늘 하루의 활동 데이터를 정리하고, 강도 분석과 칼로리 밸런스를 포함해줘:
- 오늘 운동 기록이 있으면 분석 (거리, 페이스, HR, TE, intensityLabel, Zone 분포)
- 걸음 수, 활동 칼로리
- 오늘 칼로리 밸런스 (결손/잉여, 섭취 vs 섭취가능) — get_weight_loss_status로 조회
- 스트레스 분포 (고/중/저 비율)
- 바디배터리 소모량 (bodyBatteryDrained) vs 충전량 (bodyBatteryCharged) 비교
- 취침 전 회복 필요성 평가 (고강도 운동 후 회복 경고 규칙 확인)
- 내일 운동 계획 제안 (Zone 기반, 칼로리 밸런스 고려)
- 경고 규칙에 해당하면 반드시 경고 포함

간결한 마크다운으로 작성.`;

/** 리포트 생성 전 최신 데이터 싱크 */
async function preSyncForReport(): Promise<void> {
  try {
    console.log("[report] 리포트 전 데이터 싱크 시작");
    await syncAll({
      startDate: daysAgoKST(1),
      endDate: todayKST(),
      dataTypes: ["sleep", "daily_stats", "heart_rate", "activities"],
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
  reportDate?: string
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
  await preSyncForReport();
  console.log(`[${category}] preSync 완료, askAdvisor 시작`);

  // cron 채널은 단발 강제 — 매번 fresh 세션 (이전 호출 컨텍스트 오염 차단)
  const channel = `cron-${category.replace("_report", "")}`;
  resetSession(channel);
  const { result } = await askAdvisor(prompt, { channel });
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
}): Promise<{ job: ReportJob; result: string | null }> {
  const { category, prompt, force, reportDate, background } = params;

  const { job, created } = await createOrGetReportJob({
    category,
    reportDate,
    force,
  });

  // 이미 running 이면 재실행 X. web 은 fire-and-forget (그대로 jobId 반환), cron 도 그대로 결과 조회.
  const shouldRun = created && job.status === "pending";

  if (shouldRun) {
    const runner = runReportJob(job.id, async () => {
      await generateReport(category, prompt, force, reportDate);
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
 * cron / 기존 동기 흐름 유지 — 완료 대기 후 리포트 텍스트 반환.
 */
export async function generateMorningReport(
  force = false,
  reportDate?: string,
): Promise<string> {
  const { result } = await runReportViaJob({
    category: "morning_report",
    prompt: MORNING_PROMPT,
    force,
    reportDate: reportDate ?? kstDateStr(),
    background: false,
  });
  if (!result) {
    throw new Error("morning_report 결과 조회 실패 (job 완료 후 record 부재)");
  }
  return result;
}

export async function generateEveningReport(
  force = false,
  reportDate?: string,
): Promise<string> {
  const { result } = await runReportViaJob({
    category: "evening_report",
    prompt: EVENING_PROMPT,
    force,
    reportDate: reportDate ?? kstDateStr(),
    background: false,
  });
  if (!result) {
    throw new Error("evening_report 결과 조회 실패 (job 완료 후 record 부재)");
  }
  return result;
}
