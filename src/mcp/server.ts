import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  getActivities,
  getSleep,
  getHeartRate,
  getDailyStats,
  getBodyComposition,
  getTrends,
} from "./tools/fitness";
import { getActivitySplits } from "./tools/splits";
import { getWeightLossStatus } from "./tools/weight-loss";
import { getBloodPressure } from "./tools/blood-pressure";
import { getUserProfile, getMetricHistory } from "./tools/user-profile";
import { getReadinessScore } from "./tools/readiness";
import { getTrainingLoadTrend } from "./tools/training-load";
import { getPaceProgression } from "./tools/pace-progression";
import { getCalendarSummary } from "./tools/calendar";
import { getInjuryRiskScore } from "./tools/injury-risk";
import { getRacePrediction } from "./tools/race-prediction";
import {
  generateTrainingPlan,
  getActiveTrainingPlan,
} from "./tools/training-plan";

const server = new McpServer({
  name: "myfitness",
  version: "1.0.0",
});

server.tool(
  "get_activities",
  "최근 운동 활동 목록 조회 (거리, 페이스, 심박, 칼로리 등)",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 14)"),
    type: z.string().optional().describe("활동 타입 필터 (running, strength 등)"),
  },
  async (args) => getActivities(args)
);

server.tool(
  "get_sleep",
  "수면 기록 조회 (수면 단계, 점수, 시작/종료 시간)",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 14)"),
  },
  async (args) => getSleep(args)
);

server.tool(
  "get_heart_rate",
  "안정시 심박수 + HRV 추세 조회",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 30)"),
  },
  async (args) => getHeartRate(args)
);

server.tool(
  "get_daily_stats",
  "일일 통계 조회 (걸음, 칼로리, 스트레스, 바디배터리)",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 14)"),
  },
  async (args) => getDailyStats(args)
);

server.tool(
  "get_body_composition",
  "체중/체지방 추세 조회",
  {
    days: z.number().int().positive().max(365).optional().describe("조회 일수 (기본 90)"),
  },
  async (args) => getBodyComposition(args)
);

server.tool(
  "get_trends",
  "주간 또는 월간 집계 통계 (활동, 일일, 수면 종합)",
  {
    period: z.enum(["week", "month"]).describe("집계 기간 (week 또는 month)"),
  },
  async (args) => getTrends(args)
);

server.tool(
  "get_activity_splits",
  "특정 활동의 km별(lap별) 구간 데이터 조회 (페이스/심박/케이던스/고도/강도 타입). 한계치 런·인터벌 분석에 사용.",
  {
    activityId: z
      .string()
      .trim()
      .min(1)
      .describe("활동의 DB id(cuid) 또는 Garmin garminId 문자열"),
  },
  async (args) => getActivitySplits(args)
);

server.tool(
  "get_weight_loss_status",
  "최근 7일 체중·칼로리·운동 통합 요약. 감량 진행도, 근손실 위험 평가, 리포트 작성에 사용.",
  {},
  async () => getWeightLossStatus()
);

server.tool(
  "get_blood_pressure",
  "혈압 추세 조회 (수축기/이완기/맥박, 카테고리 분류, 경고). 건강 지표 연계 분석에 사용.",
  {
    days: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .describe("조회 일수 (기본 30)"),
  },
  async (args) => getBloodPressure(args)
);

server.tool(
  "get_user_profile",
  "사용자 프로필 + Garmin 자동 동기화된 maxHR/LTHR/Zone/VO2max 통합 조회. 각 값에 source 표시.",
  {},
  async () => getUserProfile()
);

server.tool(
  "get_metric_history",
  "프로필 메트릭(maxHR/lthr/lthrPace/vo2maxRunning/restingHRBase) 변경 이력 조회. 시간 경과에 따른 피트니스 변화 추적.",
  {
    field: z
      .enum(["maxHR", "lthr", "lthrPace", "vo2maxRunning", "restingHRBase"])
      .optional()
      .describe("필드 필터. 생략하면 모든 필드"),
    days: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .describe("조회 일수 (기본 90)"),
  },
  async (args) => getMetricHistory(args)
);

server.tool(
  "get_readiness_score",
  "오늘 회복 점수 (Garmin bodyBatteryHigh 기반, 0-100) + 5단계 강도 추천 + HRV/restingHR 7일 평균 대비 deviation + 어제 트레이닝 로드. 모닝 리포트의 오늘 강도 결정에 사용.",
  {},
  async () => getReadinessScore()
);

server.tool(
  "get_training_load_trend",
  "트레이닝 로드 추세 (ACWR 기반). Acute 7d / Chronic 28d / 보조 14d 일평균 부하 + ACWR + 4단계 위험 구간 (detraining / sweet_spot / high / very_high). 주간 리포트의 오버/언더트레이닝 평가에 사용.",
  {},
  async () => getTrainingLoadTrend()
);

server.tool(
  "get_pace_progression",
  "거리 bucket(5k/10k/HM/FM)별 러닝 페이스 추세. baseline/latest/best + improvementPct(%) + 최근 5건. 주간/장기 리포트의 진척도 평가에 사용.",
  {
    windowDays: z
      .number()
      .int()
      .min(30)
      .max(365)
      .optional()
      .describe("조회 일수 (기본 90, 30~365)"),
  },
  async (args) => getPaceProgression(args)
);

server.tool(
  "get_calendar_summary",
  "N일 일자별 핵심 지표 한 줄씩 (최신순) — 러닝 km/횟수, 안정시HR, 수면 점수/시간, bodyBattery, 칼로리 밸런스, 걸음수. summary에 기간 총합. 주간/월간 리포트에서 일자별 상황 훑기에 사용.",
  {
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("조회 일수 (기본 14, 1~90)"),
  },
  async (args) => getCalendarSummary(args)
);

server.tool(
  "get_injury_risk_score",
  "부상/오버트레이닝 위험 점수 (0-100) + 4단계 라벨 (safe/caution/elevated/high) + 기여 요인 top 3 + 권장 조치. 4개 요인 각 25% 가중치: HRV 하락(7일 vs 이전 7일), ACWR(M5-2-2 동일), 수면 점수 불안정(14일 CV), RHR 상승(7일 vs 28일 baseline). 모닝 리포트의 회복일/강도 결정에 사용.",
  {},
  async () => getInjuryRiskScore()
);

server.tool(
  "generate_training_plan",
  "4주 트레이닝 플랜을 결정적으로 생성 + DB 저장. 입력: weeklyFrequency(3~5, 기본 4), targetDistance(5K/10K/HM/FM, optional), targetDate(YYYY-MM-DD, targetDistance 필수). 기존 active plan 은 archived 처리. Wk1 baseline / Wk2 +10% / Wk3 +10% / Wk4 taper. LTHR pace 기반 zone/pace 배분. race 목표 있고 targetDate 가 plan 창 내면 Wk4 는 targetDate 까지 선형 감소 + race 당일 rest.",
  {
    weeklyFrequency: z
      .number()
      .int()
      .min(3)
      .max(5)
      .optional()
      .describe("주간 러닝 횟수 (3~5, 기본 4)"),
    targetDistance: z
      .enum(["5K", "10K", "HM", "FM"])
      .optional()
      .describe("목표 race 거리"),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("race 예정일 YYYY-MM-DD (targetDistance 와 함께만)"),
  },
  async (args) => generateTrainingPlan(args)
);

server.tool(
  "get_active_training_plan",
  "현재 active 트레이닝 플랜 조회 + 진행 파생. 각 workout 은 completed/missed/pending 상태 (workout date 의 KST 일자 러닝 activity 매칭, 계획 대비 90% 이상 거리면 completed). 오늘 workout + 전체 진행률 요약 포함.",
  {},
  async () => getActiveTrainingPlan()
);

server.tool(
  "get_race_prediction",
  "5K/10K/HM/FM race 예상 기록 (Riegel 공식). 각 target 3 시나리오: best/realistic/conservative (source bucket의 best/latest/baseline pace). 자체 bucket 우선, 없으면 다른 bucket에서 Riegel 환산. confidence는 count 기반. '10K 페이스로 풀마라톤 도전 가능?' 같은 질문에 사용.",
  {
    windowDays: z
      .number()
      .int()
      .min(30)
      .max(365)
      .optional()
      .describe("조회 일수 (기본 90, 30~365)"),
  },
  async (args) => getRacePrediction(args)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
