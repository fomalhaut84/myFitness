// #552 M19-2: 결과 목록 표기
import { describe, expect, it } from "vitest";
import { categoryLabel, firstLine, resultDate } from "@/components/prompts/result-labels";

describe("result-labels", () => {
  it("카테고리 — 리포트 · 평가 외에는 채팅", () => {
    expect(categoryLabel("weekly_report")).toBe("주간 리포트");
    expect(categoryLabel("activity_eval")).toBe("운동 평가");
    expect(categoryLabel("sleep")).toBe("채팅");
  });
  it("첫 본문 줄 — 헤딩 · 구분선 건너뛰고 강조 기호 제거", () => {
    expect(firstLine("# 모닝 리포트\n\n---\n- **수면 점수** 82점")).toBe("수면 점수 82점");
    expect(firstLine("")).toBe("");
  });
  it("날짜 — 리포트 날짜 우선", () => {
    expect(resultDate("2026-10-19", "2026-10-18T23:00:00Z")).toBe("10-19");
    expect(resultDate(null, "2026-10-18T23:30:00Z")).toBe("10-19");
  });
});
