/**
 * M4-3: Garmin Connect에 식단/영양 데이터가 존재하는지 탐색.
 *
 * 목표:
 *  1. MFP(MyFitnessPal) 연동 시 Garmin에 식단 데이터가 내려오는지 확인
 *  2. 알려진 엔드포인트 후보를 순회하며 응답 구조 덤프
 *
 * 실행: npx tsx scripts/investigate-garmin-nutrition.ts
 */
import "dotenv/config";
import { getGarminClient } from "../src/lib/garmin/client";
import { formatDate, daysAgoKST } from "../src/lib/garmin/utils";

async function main() {
  const client = await getGarminClient();

  // 최근 3일 조사
  const dates = [daysAgoKST(1), daysAgoKST(2), daysAgoKST(3)].map(formatDate);

  console.log("=== Garmin Nutrition / Food API 탐색 ===\n");
  console.log(`조사 날짜: ${dates.join(", ")}\n`);

  // --- 1. DailySummary에 caloriesConsumed 필드가 있는지 확인 ---
  console.log("--- 1. DailySummary에서 소비 칼로리 필드 확인 ---");
  for (const dateStr of dates.slice(0, 1)) {
    try {
      const url = `https://connectapi.garmin.com/usersummary-service/usersummary/daily?calendarDate=${dateStr}`;
      const result = await client.get<Record<string, unknown>>(url);
      const nutritionKeys = Object.keys(result).filter((k) =>
        /calori|nutri|food|intake|consumed|meal|protein|carb|fat|fiber/i.test(k)
      );
      console.log(`  ${dateStr}: 관련 키 발견 ${nutritionKeys.length}개`);
      if (nutritionKeys.length > 0) {
        for (const key of nutritionKeys) {
          console.log(`    ${key}: ${JSON.stringify(result[key])}`);
        }
      } else {
        console.log("  → 식단/영양 관련 필드 없음");
      }
    } catch (error) {
      console.log(`  ${dateStr}: 에러 — ${errorMsg(error)}`);
    }
  }

  // --- 2. 영양/식단 전용 엔드포인트 후보 ---
  console.log("\n--- 2. 영양/식단 전용 엔드포인트 탐색 ---");
  const dateStr = dates[0];
  const endpoints = [
    // Garmin Connect 웹에서 관찰된 후보 엔드포인트들
    `https://connectapi.garmin.com/nutrition-service/nutrition/day/${dateStr}`,
    `https://connectapi.garmin.com/nutrition-service/nutrition/${dateStr}`,
    `https://connectapi.garmin.com/nutrition-service/nutrition/daily/${dateStr}`,
    `https://connectapi.garmin.com/wellness-service/wellness/dailyNutrition/${dateStr}`,
    `https://connectapi.garmin.com/wellness-service/wellness/nutrition/${dateStr}`,
    `https://connectapi.garmin.com/usersummary-service/usersummary/dailyCalories?calendarDate=${dateStr}`,
    `https://connectapi.garmin.com/food-service/food/day/${dateStr}`,
    `https://connectapi.garmin.com/food-service/food/daily/${dateStr}`,
    // connect.garmin.com 프록시 형태 (일부 라이브러리가 사용)
    `https://connect.garmin.com/nutrition-service/nutrition/day/${dateStr}`,
    `https://connect.garmin.com/modern/proxy/nutrition-service/nutrition/day/${dateStr}`,
    `https://connect.garmin.com/modern/proxy/usersummary-service/nutrition/${dateStr}`,
  ];

  const found: { endpoint: string; data: unknown }[] = [];
  for (const url of endpoints) {
    const short = url
      .replace("https://connectapi.garmin.com", "[connectapi]")
      .replace("https://connect.garmin.com/modern/proxy", "[proxy]")
      .replace("https://connect.garmin.com", "[connect]");
    try {
      const result = await client.get(url);
      const preview = JSON.stringify(result, null, 2).slice(0, 500);
      console.log(`  ✅ ${short}:`);
      console.log(`     ${preview}`);
      found.push({ endpoint: url, data: result });
    } catch (error) {
      console.log(`  ❌ ${short}: ${errorMsg(error)}`);
    }
    // Rate limit: Garmin은 빈번한 요청에 민감
    await delay(1500);
  }

  // --- 3. UserProfile에서 MFP 연동 상태 확인 ---
  console.log("\n--- 3. 사용자 프로필 / 연결된 앱 확인 ---");
  try {
    const profile = await client.getUserProfile();
    const profileKeys = Object.keys(profile as unknown as Record<string, unknown>).filter((k) =>
      /partner|third|app|connect|mfp|myfitnesspal|nutrition/i.test(k)
    );
    console.log(`  프로필 관련 키: ${profileKeys.length > 0 ? profileKeys.join(", ") : "없음"}`);
  } catch (error) {
    console.log(`  에러: ${errorMsg(error)}`);
  }

  // --- 4. 요약 ---
  console.log("\n" + "=".repeat(60));
  console.log("=== 탐색 결과 요약 ===");
  if (found.length > 0) {
    console.log(`\n✅ 응답 있는 엔드포인트: ${found.length}개`);
    for (const f of found) {
      console.log(`  - ${f.endpoint}`);
    }
    console.log("\n→ 식단 데이터 존재 가능! fetcher 구현 검토 필요.");
  } else {
    console.log("\n❌ 모든 후보 엔드포인트에서 식단 데이터를 찾지 못함.");
    console.log("→ Garmin Connect 경유로 MFP 데이터 접근 불가.");
    console.log("→ 대안: 비공식 MFP API, 수동 입력 UI 확장, 또는 Garmin 웹 스크래핑.");
  }
  console.log("=".repeat(60));
}

function errorMsg(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.length > 150) return msg.slice(0, 150) + "...";
    return msg;
  }
  return String(error).slice(0, 150);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
