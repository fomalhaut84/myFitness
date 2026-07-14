// M11 Phase 2 (#232) 회귀 스크립트.
// pr-review-toolkit 사전 리뷰 P1: longRunKmForWeek 감소 방향 clamp 버그 재현·수정 검증.
// 실행: npx tsx scripts/verify-goal-progression.ts
//
// 검증 시나리오:
// 1. distance 회귀 — weekCount=4, weeklyFrequency=4, targetDistance=10K 결과가 M11 Phase 1 결과와 동일한 shape (workout 배열 길이 = 28, peak 주 = week 3).
// 2. time 목표 — tempo/interval 페이스가 baseline (345 sec/km) → target (300 sec/km) 로 주차별 선형 개선. peak 주에 target 도달.
// 3. endurance 목표 (증가 방향) — baseline long 3km → target 25km, 주차별 선형 증대.
// 4. endurance 목표 (감소 방향, P1 회귀 케이스) — baseline long 26.7km → target 20km. 성장 주가 baseline 에 갇히지 않고 실제로 감소해서 target 에 도달해야 함.

import { generatePlan } from "../src/lib/training/plan-generator";
import { longRunKmForWeek } from "../src/lib/training/goal-progression";

const startDate = new Date("2026-08-01T00:00:00+09:00");
const baseInput = {
  startDate,
  weekCount: 8,
  weeklyFrequency: 4 as const,
  baselineWeeklyKm: 40,
  lthrPaceSecPerKm: null,
  recentAvgPaceSecPerKm: 345, // 5:45/km
  targetDistance: null,
  targetDate: null,
};

// --- 1. distance 회귀 -------------------------------------------------------
const distance4wk = generatePlan({ ...baseInput, weekCount: 4 });
console.log(
  "[distance] weekCount=4 workouts count:",
  distance4wk.length,
  "(expected 28)",
);

// --- 2. time 목표 ---------------------------------------------------------
const timePlan = generatePlan({
  ...baseInput,
  goalType: "time",
  timeGoal: {
    distance: "10K",
    targetTimeSec: 3000,
    targetDate: "2026-09-25",
  },
});
const tempoByWeek = new Map<number, number[]>();
for (const w of timePlan) {
  if (w.type === "tempo" && w.paceSecPerKm !== null) {
    const arr = tempoByWeek.get(w.weekNumber) ?? [];
    arr.push(w.paceSecPerKm);
    tempoByWeek.set(w.weekNumber, arr);
  }
}
console.log("[time] tempo pace by week (sec/km):");
for (const [wk, paces] of [...tempoByWeek.entries()].sort()) {
  console.log(`  Wk${wk}: ${paces.join(", ")}`);
}
// target pace = 3000 / 10 = 300 sec/km. peak 주(7) 에 300 근접해야.

// --- 3. endurance 증가 방향 -----------------------------------------------
console.log("\n[endurance ↑] baseline 3 → target 25 (growthWeeks=7):");
for (let w = 0; w < 8; w++) {
  const km = longRunKmForWeek(3, 25, w, 7, w >= 7 ? 0.8 / 1.2 : undefined);
  console.log(`  Wk${w + 1}: ${km.toFixed(2)} km`);
}

// --- 4. endurance 감소 방향 (P1 회귀) --------------------------------------
console.log("\n[endurance ↓ regression] baseline 26.7 → target 20 (growthWeeks=7):");
for (let w = 0; w < 8; w++) {
  const km = longRunKmForWeek(26.7, 20, w, 7, w >= 7 ? 0.8 / 1.2 : undefined);
  console.log(`  Wk${w + 1}: ${km.toFixed(2)} km`);
}
console.log(
  "  ↑ 성장 주가 baseline (26.7) 에 갇히지 않고 target (20) 방향으로 감소해야 함.",
);

// --- 5. time 목표 + baseline pace null (Codex P2 회귀) --------------------
// baselinePace=null 일 때 tempo/interval 이 즉시 target race pace 를 강제하지 않고
// LTHR/기본 zone 페이스로 fallback 되는지.
const timePlanNoBaseline = generatePlan({
  ...baseInput,
  recentAvgPaceSecPerKm: null, // baseline avg pace 부재
  goalType: "time",
  timeGoal: {
    distance: "10K",
    targetTimeSec: 3000, // target 300 sec/km (매우 공격적)
    targetDate: "2026-09-25",
  },
});
const week1Tempos = timePlanNoBaseline.filter(
  (w) => w.type === "tempo" && w.weekNumber === 1,
);
console.log("\n[time regression] baselinePace=null Wk1 tempo pace (sec/km):");
for (const w of week1Tempos) {
  console.log(`  ${w.paceSecPerKm} (target race pace=300, 반드시 300 이 아니어야 함)`);
}

// --- 6. FM time 목표 peak long min 승격 (Codex P2 회귀) ----------------------
// FM time 목표에서 peak 주 long slot 이 PEAK_LONG_MIN_KM['FM']=27 이상이어야.
const fmTimePlan = generatePlan({
  ...baseInput,
  weekCount: 12,
  baselineWeeklyKm: 20, // 낮은 baseline → ratio 만으로는 27km 못 채움
  goalType: "time",
  targetDistance: "FM", // MCP tool 이 timeGoal.distance 로 세팅
  timeGoal: {
    distance: "FM",
    targetTimeSec: 14400, // 4:00:00
    targetDate: "2026-10-24",
  },
});
const fmPeakWeekIdx = 12 - 2 - 1; // taperWeeks=2 for wc>8 → growthWeeks=10, peakIdx=9
const peakLongs = fmTimePlan.filter(
  (w) => w.type === "long" && w.weekNumber === fmPeakWeekIdx + 1,
);
console.log("\n[FM time regression] peak week long slot km (min 27 필요):");
for (const w of peakLongs) {
  console.log(`  Wk${w.weekNumber}: ${w.distanceKm} km`);
}
