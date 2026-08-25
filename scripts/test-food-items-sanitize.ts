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

console.log("\n== items 동기화 정책 (Codex 2회차 회귀) ==");
{
  // kcal correction 시나리오: existing kcal=400, items 합 400 (이미 정합). 새 kcal=500.
  // scaleItemsForNewKcal(500, 400, ...) → items 도 500/400 스케일 → 새 합계 500 정합.
  const existingItems = [
    { name: "비빔밥", kcal: 260, proteinG: 11, carbsG: 44, fatG: 6 },
    { name: "계란국", kcal: 140, proteinG: 6, carbsG: 4, fatG: 8 },
  ];
  const scaled = scaleItemsForNewKcal(500, 400, existingItems);
  const scaledSum = scaled!.reduce((s, it) => s + (it.kcal ?? 0), 0);
  assert(
    "kcal correction 400 → 500: items 합계도 ≈ 500",
    Math.abs(scaledSum - 500) <= 2,
    `sum=${scaledSum}`,
  );

  // backfill retained scenario: kcal=400 저장, est.kcal=550 · est.items 합 550.
  // scaleItemsForNewKcal(400, 550, ...) → 새 items 합 400 정합.
  const estItems = [
    { name: "김치찌개", kcal: 350, proteinG: 15, carbsG: 30, fatG: 15 },
    { name: "쌀밥", kcal: 200, proteinG: 5, carbsG: 40, fatG: 1 },
  ];
  const backfillScaled = scaleItemsForNewKcal(400, 550, estItems);
  const bSum = backfillScaled!.reduce((s, it) => s + (it.kcal ?? 0), 0);
  assert(
    "backfill retained 400 · est 550: items 합계도 ≈ 400",
    Math.abs(bSum - 400) <= 2,
    `sum=${bSum}`,
  );
}

console.log("\n== backfill items ↔ top-level 정합 정책 (릴리즈 PR #325 회귀) ==");
{
  // 시나리오: items 자체가 complete (모든 원소 P/C/F 있음) → items 합계로 top-level 재산출.
  const completeItems = [
    { name: "김치찌개", kcal: 400, proteinG: 15, carbsG: 30, fatG: 20 },
    { name: "쌀밥", kcal: 200, proteinG: 5, carbsG: 45, fatG: 1 },
  ];
  const allP = completeItems.every((it) => it.proteinG !== null);
  const allC = completeItems.every((it) => it.carbsG !== null);
  const allF = completeItems.every((it) => it.fatG !== null);
  assert(
    "items complete 판정 (모든 원소 non-null)",
    allP && allC && allF,
  );
  const sumP = completeItems.reduce((s, it) => s + (it.proteinG ?? 0), 0);
  assert("items 로부터 top-level P 파생 (15+5=20)", sumP === 20);

  // 시나리오: items partial (일부 원소 protein null) → itemsComplete=false → 저장 skip.
  const partialItems = [
    { name: "A", kcal: 300, proteinG: 10, carbsG: 40, fatG: 5 },
    { name: "B", kcal: 100, proteinG: null, carbsG: 20, fatG: 2 },
  ];
  const partAllP = partialItems.every((it) => it.proteinG !== null);
  assert(
    "items partial 판정 (B.proteinG null)",
    !partAllP,
  );
}

console.log("\n== backfill sourceKcal <= 0 방어 (PR #326 Codex P2 회귀) ==");
{
  // scaleItemsForNewKcal(target, source<=0, items) → 원본 items 그대로 반환 (스케일 no-op).
  // backfill 이 이 결과로 top-level 파생하면 0-kcal source 값이 positive kcal 에 mismatch 부착.
  const zeroSourceItems = [
    { name: "A", kcal: 100, proteinG: 5, carbsG: 20, fatG: 3 },
    { name: "B", kcal: 200, proteinG: 8, carbsG: 30, fatG: 5 },
  ];
  const scaled = scaleItemsForNewKcal(400, 0, zeroSourceItems);
  const scaledSum = scaled!.reduce((s, it) => s + (it.kcal ?? 0), 0);
  assert(
    "source=0 → 원본 items 유지 (scaleItemsForNewKcal 계약)",
    scaledSum === 300,
    `sum=${scaledSum} (원본 100+200=300, target 400 과 mismatch)`,
  );
  // canDeriveTopLevel 판정: source>0 이거나 source===target 이어야 파생 안전.
  const canDerive = (source: number | null, target: number) =>
    source !== null && (source > 0 || source === target);
  assert(
    "source=0, target=400 → canDerive false (0-kcal → 400-kcal mismatch)",
    !canDerive(0, 400),
  );
  assert(
    "source>0, target=400 → canDerive true",
    canDerive(550, 400),
  );
  // Codex P2 (PR #326 2회차): zero-kcal 로그 (양쪽 0) 도 파생 안전 (source=target).
  assert(
    "source=0, target=0 → canDerive true (zero-kcal 로그, 스케일 no-op 정합)",
    canDerive(0, 0),
  );
}

console.log("\n== backfill 기존 items 보존 / UI mismatch 뱃지 판정 로직 회귀 ==");
{
  // 기존 items complete → 유지 (transient 실패 시 valid items 손실 방지).
  const rItems = [
    { name: "김치찌개", kcal: 400, proteinG: 15, carbsG: 30, fatG: 20 },
    { name: "쌀밥", kcal: 200, proteinG: 5, carbsG: 45, fatG: 1 },
  ];
  const existing = sanitizeFoodItemBreakdown(rItems);
  const existingComplete =
    existing !== null &&
    existing.every(
      (it) => it.proteinG !== null && it.carbsG !== null && it.fatG !== null,
    );
  assert("existing items complete 판정", existingComplete);

  // UI mismatch 판정: items 합 vs top-level tolerance max(30, round(5%)) 초과.
  // Codex P2 (PR #327): estimator 와 동일 rounded 계산.
  const kcalMismatch = (topKcal: number, itemsSum: number) =>
    Math.abs(itemsSum - topKcal) > Math.max(30, Math.round(topKcal * 0.05));
  assert(
    "100/70 → mismatch (diff 30 > tol 30 아님 → false, 경계값)",
    !kcalMismatch(100, 70), // diff=30, tol=max(30, 5)=30 → not >
  );
  assert(
    "100/60 → mismatch true (diff 40 > tol 30)",
    kcalMismatch(100, 60),
  );
  assert(
    "600/500 → mismatch true (diff 100 > tol 30 / 600*0.05=30)",
    kcalMismatch(600, 500),
  );
  assert(
    "1000/970 → mismatch false (diff 30 = tol 50)",
    !kcalMismatch(1000, 970),
  );
  // Codex P2 (PR #327): estimator 정합 회귀. 610/579 → estimator tolerance
  // max(30, round(610*0.05)=31) = 31 (통과), UI 도 동일 tol=31 → false (뱃지 안 뜸).
  // 이전 unrounded (30.5) 로직은 31 > 30.5 → true 오판정.
  assert(
    "610/579 → mismatch false (estimator tolerance 31 정합, false positive 방지)",
    !kcalMismatch(610, 579),
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
