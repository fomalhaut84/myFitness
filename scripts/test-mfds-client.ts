// #315 수동 테스트: MFDS API 실제 호출 → raw 응답 + 파싱 결과 출력.
// 사용법:
//   npx tsx scripts/test-mfds-client.ts <검색어>
//   npx tsx scripts/test-mfds-client.ts 김치찌개

import "dotenv/config";
import { fetchMfdsFood, clearMfdsCache } from "@/lib/nutrition/food-db-mfds";

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("사용법: npx tsx scripts/test-mfds-client.ts <검색어>");
    process.exit(1);
  }
  if (!process.env.MFDS_API_KEY) {
    console.error("MFDS_API_KEY 환경변수 없음. .env 확인.");
    process.exit(1);
  }
  console.log(`[test-mfds] query: "${query}"`);
  clearMfdsCache();
  const started = Date.now();
  const hit = await fetchMfdsFood(query, { logRaw: true });
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(`\n[test-mfds] elapsed: ${elapsed}s`);
  if (!hit) {
    console.log("[test-mfds] ✗ hit 없음 (또는 응답 파싱 실패 — 위 raw 확인)");
    process.exit(1);
  }
  console.log("[test-mfds] ✓ parsed hit:");
  console.log(`  name          : ${hit.name}`);
  console.log(`  kcal /100g    : ${hit.kcalPer100g}`);
  console.log(`  protein /100g : ${hit.proteinPer100g ?? "—"} g`);
  console.log(`  carbs /100g   : ${hit.carbsPer100g ?? "—"} g`);
  console.log(`  fat /100g     : ${hit.fatPer100g ?? "—"} g`);
  console.log(`  serving size  : ${hit.servingSizeG ?? "—"} g`);
}

main().catch((err) => {
  console.error("[test-mfds] 예외:", err);
  process.exit(1);
});
