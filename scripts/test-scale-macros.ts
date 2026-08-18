// #299 회귀: scaleMacrosForNewKcal 케이스 테이블.
// Codex P2 (PR #301 19회차): zero-kcal no-op 정정에서 macros 파괴되지 않아야 함.
// 실행: npx tsx scripts/test-scale-macros.ts

import { scaleMacrosForNewKcal, type MacroValues, type ScaleMacrosResult } from "@/lib/nutrition/scale-macros";

interface Case {
  label: string;
  newKcal: number | null;
  oldKcal: number | null;
  oldMacros: MacroValues;
  expect: ScaleMacrosResult;
}

const cases: Case[] = [
  {
    label: "newKcal null → macros null · resetAttempts true",
    newKcal: null,
    oldKcal: 500,
    oldMacros: { proteinG: 20, carbsG: 60, fatG: 15 },
    expect: { proteinG: null, carbsG: null, fatG: null, resetAttempts: true },
  },
  {
    label: "no-op (500 → 500) → macros 그대로 · resetAttempts false",
    newKcal: 500,
    oldKcal: 500,
    oldMacros: { proteinG: 20, carbsG: 60, fatG: 15 },
    expect: { proteinG: 20, carbsG: 60, fatG: 15, resetAttempts: false },
  },
  {
    // Codex P2 (PR #301 19회차): zero-kcal no-op 은 macros 파괴 안 함.
    label: "zero-kcal no-op (0 → 0) → macros 그대로 (다이어트 콜라 등)",
    newKcal: 0,
    oldKcal: 0,
    oldMacros: { proteinG: 0, carbsG: 0, fatG: 0 },
    expect: { proteinG: 0, carbsG: 0, fatG: 0, resetAttempts: false },
  },
  {
    label: "oldKcal 0 → newKcal 500 (스케일 기준 없음) → macros null · resetAttempts true",
    newKcal: 500,
    oldKcal: 0,
    oldMacros: { proteinG: 0, carbsG: 0, fatG: 0 },
    expect: { proteinG: null, carbsG: null, fatG: null, resetAttempts: true },
  },
  {
    label: "oldKcal null → newKcal 500 → macros null · resetAttempts true",
    newKcal: 500,
    oldKcal: null,
    oldMacros: { proteinG: null, carbsG: null, fatG: null },
    expect: { proteinG: null, carbsG: null, fatG: null, resetAttempts: true },
  },
  {
    label: "정상 스케일 (500 → 1000, ratio 2) → macros 2배 · resetAttempts false",
    newKcal: 1000,
    oldKcal: 500,
    oldMacros: { proteinG: 20, carbsG: 60, fatG: 15 },
    expect: { proteinG: 40, carbsG: 120, fatG: 30, resetAttempts: false },
  },
  {
    label: "부분 macros (P 만) 도 스케일 · null 은 null 유지",
    newKcal: 200,
    oldKcal: 100,
    oldMacros: { proteinG: 10, carbsG: null, fatG: null },
    expect: { proteinG: 20, carbsG: null, fatG: null, resetAttempts: false },
  },
];

let allPass = true;
for (const c of cases) {
  const r = scaleMacrosForNewKcal(c.newKcal, c.oldKcal, c.oldMacros);
  const ok =
    r.proteinG === c.expect.proteinG &&
    r.carbsG === c.expect.carbsG &&
    r.fatG === c.expect.fatG &&
    r.resetAttempts === c.expect.resetAttempts;
  allPass = allPass && ok;
  console.log(`${ok ? "✓" : "✗"} ${c.label}`);
  if (!ok) {
    console.log(`  expected: ${JSON.stringify(c.expect)}`);
    console.log(`  got:      ${JSON.stringify(r)}`);
  }
}
console.log(allPass ? "ALL PASS" : "FAIL");
process.exit(allPass ? 0 : 1);
