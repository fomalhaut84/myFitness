// #299 sanity: assessMuscleLossRisk 케이스 테이블.
// 실행: npx tsx scripts/test-muscle-loss-risk.ts

import { assessMuscleLossRisk } from "@/lib/fitness/muscle-loss-risk";

interface Case {
  label: string;
  input: Parameters<typeof assessMuscleLossRisk>[0];
  expect: {
    risk: "low" | "medium" | "high";
    score: number;
  };
}

const cases: Case[] = [
  {
    label: "결손도 단백질도 정상 · 저강도 → low",
    input: {
      weeklyCalorieDeficit: 200,
      avgProteinPerKg: 1.8,
      weeklyHighIntensityMin: 10,
      proteinTargetPerKg: 1.6,
    },
    expect: { risk: "low", score: 0 },
  },
  {
    label: "결손만 초과 → low (score 1)",
    input: {
      weeklyCalorieDeficit: 600,
      avgProteinPerKg: 1.8,
      weeklyHighIntensityMin: 10,
      proteinTargetPerKg: 1.6,
    },
    expect: { risk: "low", score: 1 },
  },
  {
    label: "결손 + 고강도 → medium (score 2)",
    input: {
      weeklyCalorieDeficit: 600,
      avgProteinPerKg: 1.8,
      weeklyHighIntensityMin: 45,
      proteinTargetPerKg: 1.6,
    },
    expect: { risk: "medium", score: 2 },
  },
  {
    label: "세 조건 모두 위험 → high (score 3)",
    input: {
      weeklyCalorieDeficit: 700,
      avgProteinPerKg: 1.1,
      weeklyHighIntensityMin: 45,
      proteinTargetPerKg: 1.6,
    },
    expect: { risk: "high", score: 3 },
  },
  {
    label: "단백질 threshold 경계 (target × 0.9 = 1.44) — 미달 시 +1",
    input: {
      weeklyCalorieDeficit: 200,
      avgProteinPerKg: 1.43, // < 1.44
      weeklyHighIntensityMin: 20,
      proteinTargetPerKg: 1.6,
    },
    expect: { risk: "low", score: 1 },
  },
  {
    label: "단백질 데이터 부족 (null) — 스코어 증가 안 함",
    input: {
      weeklyCalorieDeficit: 200,
      avgProteinPerKg: null,
      weeklyHighIntensityMin: 20,
      proteinTargetPerKg: 1.6,
    },
    expect: { risk: "low", score: 0 },
  },
  {
    label: "고강도 threshold 경계 (30분 미만 통과, 초과 +1)",
    input: {
      weeklyCalorieDeficit: 200,
      avgProteinPerKg: 1.8,
      weeklyHighIntensityMin: 30, // exact threshold, > 30 이 조건이니 통과
      proteinTargetPerKg: 1.6,
    },
    expect: { risk: "low", score: 0 },
  },
  {
    label: "결손 threshold 경계 (500 미만 통과)",
    input: {
      weeklyCalorieDeficit: 500,
      avgProteinPerKg: 1.8,
      weeklyHighIntensityMin: 20,
      proteinTargetPerKg: 1.6,
    },
    expect: { risk: "low", score: 0 },
  },
];

let allPass = true;
for (const c of cases) {
  const v = assessMuscleLossRisk(c.input);
  const ok = v.risk === c.expect.risk && v.score === c.expect.score;
  allPass = allPass && ok;
  console.log(`${ok ? "✓" : "✗"} ${c.label}`);
  if (!ok) {
    console.log(`  expected: ${JSON.stringify(c.expect)}`);
    console.log(`  got:      risk=${v.risk} score=${v.score}`);
  } else if (v.reasons.length || v.recommendations.length) {
    console.log(`    reasons: ${v.reasons.join(" · ") || "(none)"}`);
    if (v.recommendations.length) console.log(`    recs:    ${v.recommendations.join(" · ")}`);
  }
}
console.log(allPass ? "ALL PASS" : "FAIL");
process.exit(allPass ? 0 : 1);
