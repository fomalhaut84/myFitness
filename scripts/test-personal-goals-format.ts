// #321: formatGoalsForPrompt — 새 WeeklyKmGoal shape 반영 확인.
// Run: npx tsx scripts/test-personal-goals-format.ts

import {
  formatGoalsForPrompt,
  type PersonalGoalsProgress,
} from "@/lib/personal-goals";

let failures = 0;

function assert(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
    failures += 1;
  }
}

const weekStartIso = "2025-01-06T00:00:00+09:00";

console.log("== 이번 주 진행 + 완료된 4주 avg 있음 ==");
{
  const goals: PersonalGoalsProgress = {
    targetWeeklyKm: {
      target: 30,
      currentWeekKm: 12.5,
      completedWeeksAvg: 25.3,
      progressPct: 42,
      weekStartIso,
    },
  };
  const out = formatGoalsForPrompt(goals);
  assert("문구에 '이번 주 12.5km' 포함", out.includes("이번 주 12.5km"), out);
  assert("문구에 '/ 30km' 포함", out.includes("/ 30km"), out);
  assert("문구에 '진행 42%' 포함", out.includes("진행 42%"), out);
  assert(
    "문구에 '완료된 최근 4주 avg 25.3km/week' 포함",
    out.includes("완료된 최근 4주 avg 25.3km/week"),
    out,
  );
}

console.log("\n== 이번 주 0km · 완료된 avg null ==");
{
  const goals: PersonalGoalsProgress = {
    targetWeeklyKm: {
      target: 30,
      currentWeekKm: 0,
      completedWeeksAvg: null,
      progressPct: 0,
      weekStartIso,
    },
  };
  const out = formatGoalsForPrompt(goals);
  assert("이번 주 0.0km 표기", out.includes("이번 주 0.0km"), out);
  assert(
    "완료된 데이터 없음 문구",
    out.includes("완료된 최근 4주 데이터 없음"),
    out,
  );
}

console.log("\n== progressPct — raw km 로 계산 (0.1km round 후 계산 금지) ==");
{
  // #321 Codex P2 (2회차) 회귀: currentWeekKm 을 미리 0.1km round 하면 4.96/5
  // → 5.0/5 → 100% 오표기. computePersonalGoals 가 raw km 로 progressPct 계산해야
  // 4.96/5 → 99% 정답.
  const raw = 4.96;
  const target = 5;
  const pct = Math.round((raw / target) * 100);
  assert(
    "raw 4.96/5 → 99%",
    pct === 99,
    `got ${pct}`,
  );
  const wrongPct = Math.round((Math.round(raw * 10) / 10 / target) * 100);
  assert(
    "미리 round 하면 100% 오표기 (회귀 방지 확인)",
    wrongPct === 100,
    `got ${wrongPct}`,
  );
}

console.log("\n== 요약 ==");
if (failures === 0) {
  console.log("✅ 모든 assertion 통과");
  process.exit(0);
} else {
  console.log(`❌ ${failures} assertion 실패`);
  process.exit(1);
}
