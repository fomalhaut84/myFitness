// #322: sanitizeFoodItemBreakdown — legacy row/malformed JSON 방어 검증.
// Run: npx tsx scripts/test-food-items-sanitize.ts

import { sanitizeFoodItemBreakdown, scaleItemsForNewKcal } from "@/lib/nutrition/food-items";

let failures = 0;

function assert(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
    failures += 1;
  }
}

console.log("== null · undefined · 잘못된 shape ==");
assert("null → null", sanitizeFoodItemBreakdown(null) === null);
assert("undefined → null", sanitizeFoodItemBreakdown(undefined) === null);
assert("빈 array → null", sanitizeFoodItemBreakdown([]) === null);
assert(
  "object (not array) → null",
  sanitizeFoodItemBreakdown({ name: "x" }) === null,
);
assert(
  "array of string → null",
  sanitizeFoodItemBreakdown(["hello"]) === null,
);
assert(
  "name 필드 없는 element → null (엄격 all-or-nothing)",
  sanitizeFoodItemBreakdown([{ kcal: 100 }]) === null,
);
assert(
  "name 이 빈 문자열 → null",
  sanitizeFoodItemBreakdown([{ name: "", kcal: 100 }]) === null,
);

console.log("\n== 정상 파싱 ==");
{
  const out = sanitizeFoodItemBreakdown([
    { name: "비빔밥", kcal: 550, proteinG: 20, carbsG: 95, fatG: 12 },
    { name: "계란국", kcal: 200, proteinG: 5, carbsG: 15, fatG: 3 },
  ]);
  assert("array 길이 2", out?.length === 2);
  assert(
    "첫 item name/kcal 유지",
    out?.[0].name === "비빔밥" && out?.[0].kcal === 550,
    JSON.stringify(out?.[0]),
  );
}

console.log("\n== 일부 필드 null / 잘못된 값 → 안전 fallback ==");
{
  const out = sanitizeFoodItemBreakdown([
    { name: "김치찌개", kcal: 400, proteinG: null, carbsG: "20" /* wrong */, fatG: 10 },
  ]);
  assert(
    "정상 name/kcal 유지",
    out?.[0].name === "김치찌개" && out?.[0].kcal === 400,
    JSON.stringify(out?.[0]),
  );
  assert("잘못된 문자열 macro → null 화", out?.[0].carbsG === null);
  assert("명시적 null 유지", out?.[0].proteinG === null);
  assert("정상 macro 유지", out?.[0].fatG === 10);
}

console.log("\n== Infinity / NaN 방어 ==");
{
  const out = sanitizeFoodItemBreakdown([
    { name: "test", kcal: Infinity, proteinG: NaN, carbsG: 5, fatG: 3 },
  ]);
  assert("Infinity → null", out?.[0].kcal === null);
  assert("NaN → null", out?.[0].proteinG === null);
  assert("정상 값 유지", out?.[0].carbsG === 5);
}

console.log("\n== scaleItemsForNewKcal — items 합계 vs top-level kcal 정합 ==");
{
  // #322 사전 리뷰 P1 회귀: hitKcal=400 · MFDS total=550 · items 합계 550.
  // 스케일 전: items 합 550 ≠ top-level 400 (사용자 혼란).
  // 스케일 후: 각 item * (400/550), 합계 ≈ 400 정합.
  const rawItems = [
    { name: "비빔밥", kcal: 350, proteinG: 15, carbsG: 60, fatG: 8 },
    { name: "계란국", kcal: 200, proteinG: 8, carbsG: 5, fatG: 12 },
  ];
  const scaled = scaleItemsForNewKcal(400, 550, rawItems);
  assert("scaled length 유지", scaled?.length === 2);
  const scaledSum = scaled!.reduce((s, it) => s + (it.kcal ?? 0), 0);
  assert(
    "scaled kcal 합 ≈ target (400, ±1 rounding)",
    Math.abs(scaledSum - 400) <= 1,
    `sum=${scaledSum}, items=${JSON.stringify(scaled)}`,
  );
  const ratio = 400 / 550;
  assert(
    "각 item kcal 비율 유지 (비빔밥 350→255)",
    scaled![0].kcal === Math.round(350 * ratio),
    `got ${scaled![0].kcal}`,
  );
  assert(
    "각 item macro 비율 유지 (proteinG 15→10.9)",
    Math.abs((scaled![0].proteinG ?? 0) - Math.round(15 * ratio * 10) / 10) < 0.05,
    `got ${scaled![0].proteinG}`,
  );
}

console.log("\n== scaleItemsForNewKcal — no-op / edge cases ==");
{
  const items = [{ name: "test", kcal: 100, proteinG: 10, carbsG: 20, fatG: 5 }];
  assert(
    "null items → null",
    scaleItemsForNewKcal(400, 550, null) === null,
  );
  assert(
    "빈 items → null",
    scaleItemsForNewKcal(400, 550, []) === null,
  );
  const same = scaleItemsForNewKcal(500, 500, items);
  assert("target=source → 원본 유지", same?.[0].kcal === 100);
  const nullTarget = scaleItemsForNewKcal(null, 550, items);
  assert("target null → 원본 유지", nullTarget?.[0].kcal === 100);
  const zeroSource = scaleItemsForNewKcal(400, 0, items);
  assert("source 0 → 원본 유지 (division 방어)", zeroSource?.[0].kcal === 100);
}

console.log("\n== 요약 ==");
if (failures === 0) {
  console.log("✅ 모든 assertion 통과");
  process.exit(0);
} else {
  console.log(`❌ ${failures} assertion 실패`);
  process.exit(1);
}
