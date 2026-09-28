// #444 (PR #456 Codex P2): get_activities 의 type 필터. "running" 은 앱의 러닝 판정 (`RUNNING_ACTIVITY_WHERE`) 과 같은 집합이어야
// virtual_run · obstacle_run 이 빠지지 않는다 — `contains("running")` 만으로는 이 둘이 누락돼 runningSummary · 주간 거리가 덜 센다.
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";

export type ActivityTypeWhere = typeof RUNNING_ACTIVITY_WHERE | { activityType: { contains: string } };

/** type 생략 → undefined (필터 없음). "running" → 러닝 계열 통합 셋. 그 외 → 부분 일치 (trail_running 등 하위 타입 지정용) */
export function activityTypeWhere(type: string | undefined): ActivityTypeWhere | undefined {
  const t = type?.trim();
  if (!t) return undefined;
  return t === "running" ? RUNNING_ACTIVITY_WHERE : { activityType: { contains: t } };
}
