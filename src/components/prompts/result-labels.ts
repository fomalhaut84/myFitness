// #552 M19-2 L4: 결과 목록 표기 — 카테고리 이름 · 첫 줄 요약 · 날짜 (순수)
import { ACTIVITY_EVAL_CATEGORY } from "@/lib/ai/activity-eval/constants";
import { formatPromptDate } from "./format";

const CATEGORY_LABELS: Record<string, string> = {
  morning_report: "모닝 리포트",
  evening_report: "이브닝 리포트",
  weekly_report: "주간 리포트",
  [ACTIVITY_EVAL_CATEGORY]: "운동 평가",
};

/** 리포트 · 평가 외에는 웹 채팅 (general · 프리셋 카테고리) */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? "채팅";
}

/** 마크다운 첫 본문 줄 — 헤딩 · 빈 줄 · 구분선을 건너뛰고 강조 기호를 뗀다 */
export function firstLine(markdown: string): string {
  const line = markdown
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#") && !/^[-*_]{3,}$/.test(l));
  return (line ?? "").replace(/^[-*>]\s+/, "").replace(/[*_`]/g, "");
}

/** 리포트 날짜가 있으면 그것 (MM-DD), 없으면 생성일 */
export function resultDate(reportDate: string | null, createdAt: string): string {
  return reportDate ? reportDate.slice(5) : formatPromptDate(createdAt);
}
