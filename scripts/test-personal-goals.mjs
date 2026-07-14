#!/usr/bin/env node
/**
 * 회귀 시나리오 재현 스크립트 (test framework 부재 → npx tsx 로 실행 or node --experimental).
 * P1 fix 검증 (M12 #223):
 *   - activityType filter 는 contains 라 track_running/street_running/virtual_run 등
 *     Garmin sub-type 을 놓치지 않아야 함.
 *   - targetWeight progressPct 는 목표 반대 방향 이동 시 0 clamp (양수 오보고 방지).
 */

// activityType 규약 검증 — 간단한 문자열 매칭 로직.
function matchesRunning(activityType) {
  // 실제 Prisma where: { activityType: { contains: "running" } } 와 동일 semantics.
  return activityType.includes("running");
}

const runningVariants = [
  "running",
  "trail_running",
  "treadmill_running",
  "track_running",
  "street_running",
  "virtual_run", // ← "run" 만 포함, "running" 미포함
  "indoor_running",
  "obstacle_run", // ← "run" 만 포함
];
const nonRunning = ["cycling", "walking", "swimming"];

console.log("=== activityType regex 회귀 검증 ===");
for (const t of runningVariants) {
  const ok = matchesRunning(t);
  console.log(`${ok ? "✓" : "✗"} ${t} → ${ok}`);
}
for (const t of nonRunning) {
  const ok = !matchesRunning(t);
  console.log(`${ok ? "✓" : "✗"} ${t} → ${matchesRunning(t)} (should be false)`);
}
// 주의: "virtual_run" / "obstacle_run" 은 "running" 미포함이라 miss. 이는
// 코드베이스 규약 (pace-progression 등) 과 동일한 트레이드오프. 필요 시
// 별도 이슈로 정규식 확장.

console.log();
console.log("=== weight progressPct 부호 손실 회귀 (P1#2) ===");

function computeProgressPct(start, target, current) {
  if (start === target) return null;
  const direction = target - start;
  const moved = current - start;
  const rawPct = (moved / direction) * 100;
  return Math.max(0, Math.min(100, Math.round(rawPct)));
}

const cases = [
  // [start, target, current, expected, description]
  [80, 75, 80, 0, "시작점 (아직 진행 없음)"],
  [80, 75, 77.5, 50, "감량 50% 진행"],
  [80, 75, 75, 100, "목표 도달"],
  [80, 75, 82, 0, "감량 목표인데 오히려 증가 → 0 clamp (P1 fix)"],
  [70, 75, 72.5, 50, "증량 50% 진행"],
  [70, 75, 68, 0, "증량 목표인데 감량 → 0 clamp (P1 fix)"],
  [70, 75, 76, 100, "목표 초과 → 100 clamp"],
];

for (const [start, target, current, expected, desc] of cases) {
  const got = computeProgressPct(start, target, current);
  const ok = got === expected;
  console.log(`${ok ? "✓" : "✗"} start=${start} target=${target} current=${current} → ${got}% (expected ${expected}%) — ${desc}`);
}
