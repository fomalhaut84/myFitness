import { askAdvisor, resetSession } from "@/lib/ai/claude-advisor";
import { syncAll } from "@/lib/garmin/sync";
import {
  todayKSTString as kstDateStr,
  todayKST,
  daysAgoKST,
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

(주의: 대부분 도구는 내부에서 \`since = daysAgo(days)\` + inclusive \`gte\` 로 계산되어
"오늘 포함 (days+1) 일" window. 정확한 7일 window 는 \`days=6\`. 예외: get_blood_pressure
는 \`days\` 를 display window length 로 그대로 사용 → 7일 원하면 \`days=7\`.)

- mcp__myfitness__get_activities(days=6, type="running") — 최근 7일 러닝 활동 목록
- mcp__myfitness__get_sleep(days=6) — 최근 7일 수면 추세 (점수, 시간)
- mcp__myfitness__get_heart_rate(days=6) — 최근 7일 심박/HRV 추세
- mcp__myfitness__get_daily_stats(days=6) — 최근 7일 걸음, 활동 칼로리, 스트레스
- mcp__myfitness__get_trends(period="week") — 전반 트렌드
- mcp__myfitness__get_training_load_trend() — 훈련 부하 추세
- mcp__myfitness__get_weight_loss_status() — 칼로리 밸런스 주간 요약
- mcp__myfitness__get_pace_progression() — 페이스 발전 추세
- mcp__myfitness__get_injury_risk_score() — 부상 위험도
- mcp__myfitness__get_blood_pressure(days=7) — 최근 7일 혈압 (시스템 프롬프트 주간 BP 경고 규칙 필수)

기억이나 추측이 아닌 위 도구 결과의 실제 수치만 인용.

## 리포트 항목 (마크다운, 간결하게)

1. 주간 운동 요약 (러닝 횟수, 총 거리, 평균 페이스, 강도 분류별 횟수)
2. 수면 분석 (평균 수면 시간, 수면 점수 추세)
3. 심박/HRV 트렌드 (피로도 판단)
4. 컨디션 종합 평가 (바디배터리, 스트레스)
5. 칼로리 밸런스 주간 요약: 평균 결손/잉여, 감량 페이스 평가, 체중 변화 (7일 이동평균)
6. 경고 사항 (시스템 프롬프트의 경고 규칙에 해당하면 반드시 포함)
7. 다음 주 추천 사항 (Zone 기반 훈련 배분 + 칼로리 밸런스 관리)
8. **개인 목표 진행 상황** (시스템 프롬프트의 "개인 목표" 섹션에 값이 있을 때만): 이번 주 진행도 (평균 페이스/주간 거리/체중 등) + 다음 주 목표 접근 전략`;

/**
 * #203: 주간 리포트 전 데이터 sync. Prompt 가 요구하는 모든 도구의 데이터를
 * 실효 있게 최신화. 두 단계로 나눔:
 *
 * (1) Incremental gap-fill — startDate 미명시 → syncAll 이 lastSyncDate + 1 부터
 *     오늘까지 자동 backfill (sync.ts:162-164). fresh DB / 신규 타입은
 *     bootstrapNewTypes 로 365일 로드. gap 은 여기서 채움.
 *
 * (2) 최근 1일 강제 refresh — startDate=daysAgoKST(1). 정상 흐름 (06:00 cron sync
 *     성공 → lastSyncDate=today) 에서 (1) 이 skip 되기 때문에 06:00~07:00 사이
 *     추가된 데이터 (밤 수면 device sync 등) 를 명시 fetch. (1) 이 lastSyncDate=today
 *     로 마킹했으므로 이 explicit range 는 gap 을 만들지 않음.
 *
 * `user_profile` 은 activities 앞에 위치 → LTHR/maxHR auto-detect 갱신을 먼저
 * 반영해야 syncActivities 가 정확한 intensityLabel/Zone 산출.
 */
async function preSyncForWeekly(): Promise<void> {
  const NON_PROFILE_TYPES = [
    "sleep",
    "daily_stats",
    "heart_rate",
    "activities",
    "blood_pressure",
    "body_composition",
  ] as const;
  try {
    // Step 1a: user_profile 을 먼저 sync — activities intensityLabel/Zone 계산
    // 시 fresh LTHR/maxHR 참조하도록. profile 실패 시 activities 는 step 1b 에서
    // 아예 skip → old zones 로 저장되는 것 원천 차단 (Codex bot P2 #4681816112).
    console.log("[weekly-report] 1a/3 user_profile sync");
    const step1a = await syncAll({
      endDate: todayKST(),
      dataTypes: ["user_profile"],
      bootstrapNewTypes: true,
    });
    const profileFailed = step1a.some((r) => r.error);
    if (profileFailed) {
      console.warn(
        "[weekly-report] user_profile sync 실패 — activities skip (stale zones 방지)",
      );
    }

    // Step 1b: 나머지 타입 incremental gap-fill. profile 실패 시 activities 제외.
    const step1bTypes = NON_PROFILE_TYPES.filter(
      (t) => !profileFailed || t !== "activities",
    );
    console.log(`[weekly-report] 1b/3 incremental: ${step1bTypes.join(",")}`);
    const step1b = await syncAll({
      endDate: todayKST(),
      dataTypes: [...step1bTypes],
      bootstrapNewTypes: true,
      // #209: get_pace_progression 90일, get_training_load_trend/injury_risk 28일 등
      // 가장 큰 요구 window (90일) 기준. 짧게 sync 된 상태 (예: /api/sync 1일) 도 backfill.
      minHistoryDays: 90,
    });

    // Step 2: 실패 타입 skip + 최근 1일 강제 refresh.
    // 실패한 타입에 explicit range (yesterday-today) 가 성공하면 updateSyncMetadata
    // 가 lastSyncDate=today 로 마킹 → 향후 gap-fill 이 tomorrow 부터 시작 →
    // 365일 backfill 이 영구히 skip 됨 (Codex bot P2).
    const failedTypes = new Set<string>([
      ...(profileFailed ? ["user_profile", "activities"] : []),
      ...step1b.filter((r) => r.error).map((r) => r.dataType),
    ]);
    const step2Types = [
      "user_profile",
      ...NON_PROFILE_TYPES,
    ].filter((t) => !failedTypes.has(t));
    if (failedTypes.size > 0) {
      console.warn(
        `[weekly-report] step 1 실패: ${[...failedTypes].join(",")} — step 2 에서 skip`,
      );
    }
    if (step2Types.length > 0) {
      console.log(
        `[weekly-report] 2/3 최근 1일 강제 refresh: ${step2Types.join(",")}`,
      );
      await syncAll({
        startDate: daysAgoKST(1),
        endDate: todayKST(),
        dataTypes: step2Types as ("user_profile" | (typeof NON_PROFILE_TYPES)[number])[],
      });
    }
    console.log("[weekly-report] 데이터 싱크 완료");
  } catch (error) {
    console.warn(
      "[weekly-report] 데이터 싱크 실패, 기존 데이터로 진행:",
      error,
    );
  }
}

/** 실제 spawn + DB save. job 안에서 호출됨. */
async function generateAndSaveWeekly(
  reportDate: string,
  force = false,
): Promise<void> {
  // #210: daily-report generateReport 와 대칭 — force=false 면 기존 record 재사용.
  // 기존엔 항상 delete+create 라 "주간 생성" 버튼 (force=false) 클릭 시 기존 리포트
  // 덮어쓰기 + AI 비용 낭비 (Codex bot P2).
  if (!force) {
    const existing = await prisma.aIAdvice.findFirst({
      where: { category: "weekly_report", reportDate },
    });
    if (existing) {
      console.log(`[weekly-report] ${reportDate} 이미 존재, 건너뜀`);
      return;
    }
  }
  // #203: 최신 데이터 sync (daily-report preSync 와 대칭).
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
      await generateAndSaveWeekly(reportDate, force);
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

/** cron / 완료 대기 흐름. #212: /ai 리포트 명시 요청 시 force=true 지원 (daily 와 대칭). */
export async function generateWeeklyReport(force = false): Promise<string> {
  const { result, job } = await runWeeklyViaJob({
    force,
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
