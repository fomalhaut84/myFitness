// #309 수동 테스트: 로컬 이미지 → estimateNutritionFromPhoto 실행 후 결과 출력.
// 사용법:
//   npx tsx scripts/test-vision-photo-estimate.ts <image-path> [caption] [mealType]
// 예:
//   npx tsx scripts/test-vision-photo-estimate.ts /tmp/food.jpg "김치찌개랑 밥" lunch

import path from "path";
import fs from "fs";
import { estimateNutritionFromPhoto } from "@/lib/nutrition/estimate-nutrition-photo";

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error("사용법: npx tsx scripts/test-vision-photo-estimate.ts <image-path> [caption] [mealType]");
    process.exit(1);
  }
  const imagePathRaw = argv[0];
  const caption = argv[1] || undefined;
  const mealType = argv[2] || undefined;

  const imagePath = path.resolve(imagePathRaw);
  if (!fs.existsSync(imagePath)) {
    console.error(`이미지 파일 없음: ${imagePath}`);
    process.exit(1);
  }

  console.log(`[vision-test] image: ${imagePath}`);
  if (caption) console.log(`[vision-test] caption: ${caption}`);
  if (mealType) console.log(`[vision-test] mealType: ${mealType}`);
  console.log(`[vision-test] Vision 호출 중… (~30초)`);

  const started = Date.now();
  const result = await estimateNutritionFromPhoto({ imagePath, caption, mealType });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n[vision-test] elapsed: ${elapsed}s`);
  if (!result) {
    console.error("[vision-test] ✗ Vision 실패 (parseNutritionResponse null)");
    process.exit(1);
  }

  console.log("[vision-test] ✓ Vision 성공");
  console.log(`  총 kcal: ${result.kcal}`);
  console.log(`  P/C/F: ${result.proteinG ?? "—"}g / ${result.carbsG ?? "—"}g / ${result.fatG ?? "—"}g`);
  console.log(`  confidence: ${result.confidence}`);
  if (result.notes) console.log(`  notes: ${result.notes}`);
  console.log(`  items (${result.items.length}):`);
  for (const it of result.items) {
    console.log(
      `    - ${it.name}: ${it.kcal ?? "—"} kcal · P ${it.proteinG ?? "—"}g / C ${it.carbsG ?? "—"}g / F ${it.fatG ?? "—"}g`,
    );
  }
}

main().catch((err) => {
  console.error("[vision-test] 예외:", err);
  process.exit(1);
});
