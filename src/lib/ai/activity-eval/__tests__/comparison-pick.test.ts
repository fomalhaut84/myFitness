// 회귀: PR #446 Codex P2 (#448) — 비슷한 거리의 제외 집합이 표시용 같은 코스 10건뿐이라 11번째 이후 같은 코스가 다시 들어갔다.
import { describe, expect, it } from "vitest";
import { selectComparisons } from "../comparison-pick";

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}` }));

describe("selectComparisons", () => {
  it("같은 코스는 표시 상한까지, 비슷한 거리는 같은 코스 전부 (상한 밖 포함) 를 뺀 뒤 상한", () => {
    const same = ids("s", 14); // s1..s14 — 표시는 10건
    const similar = [...ids("s", 14).slice(9), ...ids("d", 12)]; // s10..s14 + d1..d12
    const { sameCourse, similarDistance } = selectComparisons(same, similar, { sameCourse: 10, similarDistance: 10 });
    expect(sameCourse.map((r) => r.id)).toEqual(ids("s", 10).map((r) => r.id));
    expect(similarDistance.some((r) => r.id.startsWith("s"))).toBe(false);
    expect(similarDistance.map((r) => r.id)).toEqual(ids("d", 10).map((r) => r.id));
  });

  it("빈 입력", () => {
    expect(selectComparisons([], [], { sameCourse: 10, similarDistance: 10 })).toEqual({ sameCourse: [], similarDistance: [] });
  });
});
