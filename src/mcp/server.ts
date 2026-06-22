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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
