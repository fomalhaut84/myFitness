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
