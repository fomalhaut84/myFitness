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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
