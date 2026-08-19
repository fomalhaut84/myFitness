// #315 수동 통합 테스트: description → MFDS estimator (extract + fetch + scale).
// 사용법:
//   npx tsx scripts/test-estimate-nutrition-mfds.ts "김치찌개 밥"
//   npx tsx scripts/test-estimate-nutrition-mfds.ts "아침 그릭요거트 그래놀라"

import "dotenv/config";
import { estimateNutritionFromMfds } from "@/lib/nutrition/estimate-nutrition-mfds";

async function main() {
  const description = process.argv[2];
  if (!description) {
    console.error("사용법: npx tsx scripts/test-estimate-nutrition-mfds.ts <description>");
    process.exit(1);
  }
  if (!process.env.MFDS_API_KEY) {
    console.error("MFDS_API_KEY 환경변수 없음. .env 확인.");
    process.exit(1);
  }
  console.log(`[test-mfds-est] description: "${description}"`);
  const started = Date.now();
  const result = await estimateNutritionFromMfds({ description });
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(`\n[test-mfds-est] elapsed: ${elapsed}s`);
  if (!result) {
    console.log("[test-mfds-est] ✗ null (AI 폴백 대상)");
    process.exit(1);
  }
  console.log("[test-mfds-est] ✓ result:");
  console.log(`  total kcal    : ${result.kcal}`);
  console.log(`  P/C/F         : ${result.proteinG ?? "—"}g / ${result.carbsG ?? "—"}g / ${result.fatG ?? "—"}g`);
  console.log(`  confidence    : ${result.confidence}`);
  console.log(`  notes         : ${result.notes ?? "—"}`);
  console.log(`  items (${result.items.length}):`);
  for (const it of result.items) {
    console.log(
      `    - ${it.name}: ${it.kcal ?? "—"} kcal · P ${it.proteinG ?? "—"}g / C ${it.carbsG ?? "—"}g / F ${it.fatG ?? "—"}g`,
    );
  }
}

main().catch((err) => {
  console.error("[test-mfds-est] 예외:", err);
  process.exit(1);
});
