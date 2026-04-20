import "dotenv/config";
import { getGarminClient, resetClient } from "../src/lib/garmin/client";

async function main() {
  const client = await getGarminClient();
  const dateStr = "2026-04-06";

  // 1. 라이브러리 내장 메서드
  console.log("--- getDailyWeightData ---");
  try {
    const result = await client.getDailyWeightData(new Date("2026-04-06"));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log("에러:", error instanceof Error ? error.message : error);
  }

  // 2. connectapi 엔드포인트 후보
  const urls = [
    `https://connectapi.garmin.com/weight-service/weight/dateRange?startDate=${dateStr}&endDate=${dateStr}`,
    `https://connectapi.garmin.com/weight-service/weight/latest?date=${dateStr}`,
    `https://connectapi.garmin.com/weight-service/weight/dayview?date=${dateStr}`,
  ];

  for (const url of urls) {
    const short = url.replace("https://connectapi.garmin.com", "");
    try {
      const result = await client.get(url);
      console.log(`\n[${short}] 성공:`, JSON.stringify(result, null, 2).slice(0, 500));
    } catch (error) {
      console.log(`\n[${short}] 에러:`, (error instanceof Error ? error.message : String(error)).slice(0, 150));
    }
  }

  resetClient();
}

main();
