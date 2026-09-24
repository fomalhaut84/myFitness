// #448 (PR #446 Codex P2): 비교 대상 고르기 — 순수. 같은 코스는 표시 상한만큼, 비슷한 거리는 **이전 같은 코스 전부** 를 뺀 뒤 상한.
// 표시용 10건만 빼면 11번째 이후 같은 코스 기록이 "비슷한 거리" 로 다시 들어온다.

export interface ComparisonLimits {
  sameCourse: number;
  similarDistance: number;
}

export function selectComparisons<T extends { id: string }>(
  sameCourseAll: readonly T[],
  similarAll: readonly T[],
  limits: ComparisonLimits,
): { sameCourse: T[]; similarDistance: T[] } {
  const sameIds = new Set(sameCourseAll.map((r) => r.id));
  return {
    sameCourse: sameCourseAll.slice(0, limits.sameCourse),
    similarDistance: similarAll.filter((r) => !sameIds.has(r.id)).slice(0, limits.similarDistance),
  };
}
