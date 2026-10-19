// #552: 필수 문구 밖의 도구 언급이 빠지면 활성화 전에 확인받는다 (#203 — 이름이 없으면 도구 호출을 건너뛴다)
import { describe, expect, it } from "vitest";
import { PROMPT_DEFINITIONS } from "../definitions";
import { removedToolMentions, toolMentions } from "../validate";

describe("toolMentions", () => {
  it("접두 유무와 관계없이 잡고, 더 긴 이름의 일부는 잡지 않는다", () => {
    const body = "- get_weight_loss_status 도구로 조회\n- mcp__myfitness__get_activities(days=6)\n- get_activity_context(activityId)";
    expect(toolMentions(body).sort()).toEqual(["get_activities", "get_activity_context", "get_weight_loss_status"]);
  });

  it("모닝 기본 프롬프트의 칼로리 밸런스 도구를 잡는다", () => {
    expect(toolMentions(PROMPT_DEFINITIONS.morning_report.defaultBody)).toContain("get_weight_loss_status");
  });
});

describe("removedToolMentions", () => {
  it("필수 문구가 아닌 도구 줄을 지우면 잡는다 (모닝 칼로리 밸런스)", () => {
    const before = PROMPT_DEFINITIONS.morning_report.defaultBody;
    const after = before
      .split("\n")
      .filter((l) => !l.includes("get_weight_loss_status"))
      .join("\n");
    expect(removedToolMentions(before, after)).toEqual(["get_weight_loss_status"]);
  });

  it("도구를 더하거나 그대로면 빈 배열", () => {
    expect(removedToolMentions("get_sleep", "get_sleep\nget_trends")).toEqual([]);
  });
});
