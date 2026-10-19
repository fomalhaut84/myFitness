// 어드바이저 (Claude CLI) 가 승인 없이 쓰는 MCP 도구 — `claude-advisor.ts` --allowedTools 와 #552 프롬프트 검증 (모르는 도구 경고) 이 공유한다.
// 주의: 여기 나열된 도구는 승인 프롬프트 없이 실행됨. mutating 도구(generate_training_plan
// 등) 는 스케줄 리포트/일반 채팅에서 의도치 않게 상태를 바꿀 수 있으므로 여기에 포함하지 않음.
// Plan 생성은 명시적 진입점 (POST /api/training-plan/generate) 에서 처리하고,
// AI 는 read-only get_active_training_plan 만 사용.
// #377 Codex P1: 새 read-only 도구는 여기에도 추가해야 -p 비대화형에서 승인 없이 실행된다.
//   verify-mcp-long-history [7] 이 server.ts 등록 도구와 이 목록의 불일치를 잡는다.
export const ADVISOR_ALLOWED_TOOLS: readonly string[] = [
  "mcp__myfitness__get_activities",
  "mcp__myfitness__get_sleep",
  "mcp__myfitness__get_heart_rate",
  "mcp__myfitness__get_daily_stats",
  "mcp__myfitness__get_body_composition",
  "mcp__myfitness__get_trends",
  "mcp__myfitness__get_activity_splits",
  "mcp__myfitness__get_activity_context",
  "mcp__myfitness__get_personal_records",
  "mcp__myfitness__get_weight_loss_status",
  "mcp__myfitness__get_blood_pressure",
  "mcp__myfitness__get_user_profile",
  "mcp__myfitness__get_metric_history",
  "mcp__myfitness__get_readiness_score",
  "mcp__myfitness__get_training_load_trend",
  "mcp__myfitness__get_pace_progression",
  "mcp__myfitness__get_calendar_summary",
  "mcp__myfitness__get_injury_risk_score",
  "mcp__myfitness__get_race_prediction",
  "mcp__myfitness__get_active_training_plan",
  "mcp__myfitness__recommend_today_workout",
  "mcp__myfitness__get_personal_goals",
  "mcp__myfitness__get_data_coverage",
  "mcp__myfitness__get_fitness_metric_trend",
  "mcp__myfitness__get_checkup_history",
  "mcp__myfitness__get_checkup_item_trend",
  "mcp__myfitness__get_medications",
];

/** 일부러 allowlist 에서 뺀 mutating 도구 — 프롬프트가 "호출하지 마세요" 로 언급하는 건 정상이라 #552 검증 경고에서 제외 */
export const ADVISOR_EXCLUDED_TOOLS: readonly string[] = ["mcp__myfitness__generate_training_plan"];
