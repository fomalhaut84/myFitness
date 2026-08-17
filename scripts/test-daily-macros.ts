// #299 회귀: aggregateDailyMacros / averageMacros null propagate.
// Codex P1 (PR #300): 로그 없는 날이 0-intake 로 취급되면 averageMacros denominator 를
// 오염시켜 protein/kg 이 잘못 낮게 나온다. 빈 날은 반드시 null 필드로 반환해야 함.
// 실행: npx tsx scripts/test-daily-macros.ts

import { averageMacros, type DailyMacros } from "@/lib/nutrition/daily-macros";

function day(date: string, over?: Partial<DailyMacros>): DailyMacros {
  return {
    date,
    kcal: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    itemCount: 0,
    missingCount: 0,
    ...over,
  };
}

interface Case {
  label: string;
  input: DailyMacros[];
  expect: {
    avgKcal: number | null;
    avgProteinG: number | null;
    daysWithProtein: number;
    totalDays: number;
    // Codex P2 (PR #303 18회차): 필요 시만 검사 (기존 케이스는 생략).
    avgProteinGRaw?: number | null;
    avgProteinGRawApprox?: { value: number; epsilon: number };
  };
}

const cases: Case[] = [
  {
    label: "3일 데이터 + 4일 빈 날 → daysWithProtein=3 (희석 없음)",
    input: [
      day("2026-08-05"), // empty
      day("2026-08-06"), // empty
      day("2026-08-07"), // empty
      day("2026-08-08"), // empty
      day("2026-08-09", { proteinG: 100, kcal: 2000, itemCount: 4 }),
      day("2026-08-10", { proteinG: 120, kcal: 2200, itemCount: 5 }),
      day("2026-08-11", { proteinG: 90,  kcal: 1900, itemCount: 3 }),
    ],
    expect: {
      avgKcal: Math.round((2000 + 2200 + 1900) / 3),
      avgProteinG: Math.round(((100 + 120 + 90) / 3) * 10) / 10,
      daysWithProtein: 3,
      totalDays: 7,
    },
  },
  {
    label: "전부 빈 날 → 모든 avg null · daysWithProtein=0",
    input: [day("2026-08-05"), day("2026-08-06"), day("2026-08-07")],
    expect: { avgKcal: null, avgProteinG: null, daysWithProtein: 0, totalDays: 3 },
  },
  {
    label: "부분 미측정 (proteinG null 인 날은 protein denominator 제외)",
    input: [
      day("2026-08-09", { proteinG: 100, kcal: 2000, itemCount: 4 }),
      day("2026-08-10", { proteinG: null, kcal: 2200, itemCount: 5, missingCount: 1 }),
      day("2026-08-11", { proteinG: 80, kcal: 1900, itemCount: 3 }),
    ],
    expect: {
      avgKcal: Math.round((2000 + 2200 + 1900) / 3),
      avgProteinG: Math.round(((100 + 80) / 2) * 10) / 10,
      daysWithProtein: 2,
      totalDays: 3,
    },
  },
  {
    // Codex P2 (PR #303 18회차): daily 총량 반올림 (round1) 이 상류에서 손실되는 precision 을
    // proteinGRaw 로 보존. 예: 100.9×6 + 101.2×1, 실제 100.942857... — round1 은 100.9 로 축소.
    // 70.09kg 사용자 · target 1.6 · floor 1.44 기준: unrounded 1.44019 (safe), rounded 1.43958
    // (false positive) 인 경계.
    label: "unrounded proteinGRaw 로 정밀 avg 유지 (100.9×6 + 101.2×1)",
    input: [
      day("d1", { proteinG: 100.9, proteinGRaw: 100.9, kcal: 2000, itemCount: 3 }),
      day("d2", { proteinG: 100.9, proteinGRaw: 100.9, kcal: 2000, itemCount: 3 }),
      day("d3", { proteinG: 100.9, proteinGRaw: 100.9, kcal: 2000, itemCount: 3 }),
      day("d4", { proteinG: 100.9, proteinGRaw: 100.9, kcal: 2000, itemCount: 3 }),
      day("d5", { proteinG: 100.9, proteinGRaw: 100.9, kcal: 2000, itemCount: 3 }),
      day("d6", { proteinG: 100.9, proteinGRaw: 100.9, kcal: 2000, itemCount: 3 }),
      day("d7", { proteinG: 101.2, proteinGRaw: 101.2, kcal: 2000, itemCount: 3 }),
    ],
    expect: {
      avgKcal: 2000,
      avgProteinG: Math.round(((100.9 * 6 + 101.2) / 7) * 10) / 10, // 100.9
      avgProteinGRawApprox: { value: (100.9 * 6 + 101.2) / 7, epsilon: 1e-9 }, // ≈ 100.942857
      daysWithProtein: 7,
      totalDays: 7,
    },
  },
];

let allPass = true;
for (const c of cases) {
  const avg = averageMacros(c.input);
  let ok =
    avg.avgKcal === c.expect.avgKcal &&
    avg.avgProteinG === c.expect.avgProteinG &&
    avg.daysWithProtein === c.expect.daysWithProtein &&
    avg.totalDays === c.expect.totalDays;
  if (c.expect.avgProteinGRaw !== undefined) {
    ok = ok && avg.avgProteinGRaw === c.expect.avgProteinGRaw;
  }
  if (c.expect.avgProteinGRawApprox !== undefined) {
    const target = c.expect.avgProteinGRawApprox.value;
    const eps = c.expect.avgProteinGRawApprox.epsilon;
    ok = ok && avg.avgProteinGRaw !== null && Math.abs(avg.avgProteinGRaw - target) < eps;
  }
  allPass = allPass && ok;
  console.log(`${ok ? "✓" : "✗"} ${c.label}`);
  if (!ok) {
    console.log(`  expected: ${JSON.stringify(c.expect)}`);
    console.log(`  got:      ${JSON.stringify({
      avgKcal: avg.avgKcal,
      avgProteinG: avg.avgProteinG,
      avgProteinGRaw: avg.avgProteinGRaw,
      daysWithProtein: avg.daysWithProtein,
      totalDays: avg.totalDays,
    })}`);
  }
}
console.log(allPass ? "ALL PASS" : "FAIL");
process.exit(allPass ? 0 : 1);
