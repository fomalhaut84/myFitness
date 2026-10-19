// #552: 변수 치환 · 줄 단위 diff (편집 화면 버전 비교)
import { describe, expect, it } from "vitest";
import { diffLines, diffStats, foldDiff } from "../diff";
import { renderPrompt } from "../render";
import { buildWeeklyReportPrompt } from "@/lib/report-prompts";
import { PROMPT_DEFINITIONS } from "../definitions";

describe("renderPrompt", () => {
  it("모든 {{name}} 을 값으로 바꾸고 단일 중괄호는 남긴다", () => {
    expect(renderPrompt("a={{x}}, b={{y}}, {json}", { x: "1", y: "2" })).toBe("a=1, b=2, {json}");
  });

  it("값이 없는 변수는 throw — 호출자가 코드 기본값으로 폴백한다", () => {
    expect(() => renderPrompt("{{missing}}", {})).toThrow(/missing/);
  });

  it("치환된 값 안의 {{…}} 는 다시 해석하지 않는다", () => {
    expect(renderPrompt("{{a}}", { a: "{{b}}", b: "x" })).toBe("{{b}}");
  });

  it("주간 기본 템플릿 렌더 결과에 구체 날짜 · 창이 박힌다 (PR #453 Codex P2)", () => {
    const prompt = buildWeeklyReportPrompt("2026-09-17", PROMPT_DEFINITIONS.weekly_report.defaultBody);
    expect(prompt).toContain('get_activities(days=27, endDate="2026-09-17", type="running")');
    expect(prompt).not.toMatch(/\{\{/);
  });
});

describe("diffLines", () => {
  it("같은 본문은 모두 same", () => {
    expect(diffLines("a\nb", "a\nb").every((l) => l.type === "same")).toBe(true);
  });

  it("추가 · 삭제를 줄 번호와 함께", () => {
    const lines = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(lines).toEqual([
      { type: "same", text: "a", oldLine: 1, newLine: 1 },
      { type: "del", text: "b", oldLine: 2 },
      { type: "add", text: "B", newLine: 2 },
      { type: "same", text: "c", oldLine: 3, newLine: 3 },
      { type: "add", text: "d", newLine: 4 },
    ]);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("빈 본문 ↔ 내용", () => {
    expect(diffStats(diffLines("", "x\ny"))).toEqual({ added: 2, removed: 1 });
  });
});

describe("foldDiff", () => {
  it("바뀐 줄 앞뒤 2줄만 남기고 나머지는 접는다", () => {
    const old = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n");
    const blocks = foldDiff(diffLines(old, old.replace("l5", "L5")));
    expect(blocks[0]).toEqual({ kind: "fold", count: 3 });
    expect(blocks.filter((b) => b.kind === "line")).toHaveLength(6);
    expect(blocks.at(-1)).toEqual({ kind: "fold", count: 2 });
  });

  it("바뀐 줄이 없으면 전부 접힌다", () => {
    expect(foldDiff(diffLines("a\nb", "a\nb"))).toEqual([{ kind: "fold", count: 2 }]);
  });
});
