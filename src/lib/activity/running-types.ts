// #261: 러닝 계열 activityType 판정. 서버(prisma 사용) 와 클라이언트 (React 컴포넌트)
// 양쪽에서 참조하므로 prisma import 가 없는 별도 파일로 분리.

/** Garmin activityType 러닝 계열 통합 셋 (track/street/trail/indoor/treadmill/virtual/obstacle). */
export const RUNNING_TYPES: ReadonlySet<string> = new Set([
  "running",
  "track_running",
  "street_running",
  "trail_running",
  "indoor_running",
  "treadmill_running",
  "virtual_run",
  "obstacle_run",
]);

/** 러닝 계열이면 true. Garmin 이 신규 subtype 을 도입해도 이름에 "running" 있으면 커버. */
export function isRunningType(activityType: string): boolean {
  return RUNNING_TYPES.has(activityType) || activityType.includes("running");
}

/**
 * #396: `isRunningType` 과 같은 조건을 DB 에서 — 통합 셋 `in` + `contains: "running"` 폴백. 개인 기록 · 커버리지 집계가 공유한다
 * (PR #412 Codex P2: `contains` 만 쓰면 `virtual_run` · `obstacle_run` 이 빠져 앱의 다른 러닝 카운트와 어긋난다).
 */
export const RUNNING_ACTIVITY_WHERE = {
  OR: [{ activityType: { in: Array.from(RUNNING_TYPES) } }, { activityType: { contains: "running" } }],
};
