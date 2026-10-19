// #552: 웹에서 관리하는 프롬프트 정의 — 키 · 화면 문구 · 코드 기본값 · 검증 규칙의 정본. 순수 (prisma 없음) — 클라이언트 편집기도 import 한다.
// 키 추가 · 삭제는 코드로만 (DB CHECK 제약 `PromptVersion_key_check` 도 같이 바꾼다).
import { ACTIVITY_EVAL_BRIEF_PROMPT_DEFAULT, ACTIVITY_EVAL_PROMPT_DEFAULT } from "./defaults/activity-eval";
import { EVENING_PROMPT_DEFAULT, MORNING_PROMPT_DEFAULT, WEEKLY_PROMPT_DEFAULT } from "./defaults/reports";
import { SYSTEM_PROMPT_DEFAULT } from "./defaults/system";

export const PROMPT_KEYS = ["system", "morning_report", "evening_report", "weekly_report", "activity_eval", "activity_eval_brief"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export type PromptGroup = "common" | "report" | "activity";

export const PROMPT_GROUP_LABELS: Record<PromptGroup, string> = {
  common: "공통",
  report: "리포트",
  activity: "운동 평가",
};

export interface PromptVariable {
  name: string;
  description: string;
}

export interface PromptDefinition {
  key: PromptKey;
  group: PromptGroup;
  label: string;
  /** 언제 · 어디서 쓰이나 (목록 카드) */
  usage: string;
  defaultBody: string;
  /** 본문에 반드시 있어야 하는 `{{name}}` — 이 밖의 변수는 오류 */
  variables: readonly PromptVariable[];
  /** 빠지면 기능이 깨지는 문구 (도구 호출 · 회귀 가드). #444 · #203: 이름을 빼면 Sonnet 이 도구를 건너뛴다 */
  requiredSnippets: readonly string[];
}

export const PROMPT_DEFINITIONS: Record<PromptKey, PromptDefinition> = {
  system: {
    key: "system",
    group: "common",
    label: "시스템 프롬프트",
    usage: "모든 AI 응답의 바탕 — 웹 채팅 · 텔레그램 · 리포트 · 운동 평가",
    defaultBody: SYSTEM_PROMPT_DEFAULT,
    variables: [],
    requiredSnippets: [],
  },
  morning_report: {
    key: "morning_report",
    group: "report",
    label: "모닝 리포트",
    usage: "매일 아침 텔레그램 · 리포트 화면",
    defaultBody: MORNING_PROMPT_DEFAULT,
    variables: [],
    requiredSnippets: ["get_blood_pressure(days=7)", "recommend_today_workout"],
  },
  evening_report: {
    key: "evening_report",
    group: "report",
    label: "이브닝 리포트",
    usage: "매일 저녁 텔레그램 · 리포트 화면",
    defaultBody: EVENING_PROMPT_DEFAULT,
    variables: [],
    requiredSnippets: ["get_activity_context(activityId)", "get_personal_records()"],
  },
  weekly_report: {
    key: "weekly_report",
    group: "report",
    label: "주간 리포트",
    usage: "매주 월요일 텔레그램 · 리포트 화면",
    defaultBody: WEEKLY_PROMPT_DEFAULT,
    variables: [
      { name: "currentDays", description: "이번 주 창 (오늘 포함 7일 = 6)" },
      { name: "baselineDays", description: "직전 4주 창 폭 (27)" },
      { name: "baselineEndDate", description: "직전 4주 창의 끝 날짜 (오늘 − 7일)" },
    ],
    requiredSnippets: [
      'get_activities(days={{currentDays}}, type="running")',
      'get_activities(days={{baselineDays}}, endDate="{{baselineEndDate}}", type="running")',
      'get_fitness_metric_trend(days=13, granularity="daily")',
      "get_active_training_plan()",
      "get_blood_pressure(days=7)",
      "get_personal_records()",
      "get_body_composition(days=27)",
      // 회귀: PR #462 Codex P1 — 150분 비교는 가중 합으로
      "totals.weightedIntensityMinTotal",
    ],
  },
  activity_eval: {
    key: "activity_eval",
    group: "activity",
    label: "러닝 평가",
    usage: "활동 상세 \"AI 평가\" — 러닝 계열",
    defaultBody: ACTIVITY_EVAL_PROMPT_DEFAULT,
    variables: [
      { name: "sections", description: "서버가 조립한 지표 섹션 (마크다운)" },
      { name: "sectionTitles", description: "포함된 섹션 제목 (· 로 연결)" },
    ],
    requiredSnippets: [],
  },
  activity_eval_brief: {
    key: "activity_eval_brief",
    group: "activity",
    label: "기타 운동 평가",
    usage: "활동 상세 \"AI 평가\" — 러닝 외 (짧은 요약)",
    defaultBody: ACTIVITY_EVAL_BRIEF_PROMPT_DEFAULT,
    variables: [{ name: "sections", description: "서버가 조립한 기본 지표 섹션" }],
    requiredSnippets: [],
  },
};

export function isPromptKey(value: string): value is PromptKey {
  return (PROMPT_KEYS as readonly string[]).includes(value);
}

/** 본문 길이 상한 — 시스템 프롬프트 기본값의 수 배 */
export const PROMPT_MAX_LENGTH = 20_000;

/** 변경 메모 길이 상한 */
export const PROMPT_NOTE_MAX_LENGTH = 200;
