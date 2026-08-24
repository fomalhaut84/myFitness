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

console.log("\n== 요약 ==");
if (failures === 0) {
  console.log("✅ 모든 assertion 통과");
  process.exit(0);
} else {
  console.log(`❌ ${failures} assertion 실패`);
  process.exit(1);
}
