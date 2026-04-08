import "dotenv/config";
import { getGarminClient, resetClient } from "../src/lib/garmin/client";

async function main() {
  const client = await getGarminClient();

  // 최근 러닝 활동 1개 가져오기
  const activities = await client.getActivities(0, 1);
  if (activities.length === 0) {
    console.log("활동 없음");
    return;
  }

  const activityId = activities[0].activityId;
  console.log(`활동: ${activities[0].activityName} (ID: ${activityId})\n`);

  // 1. getActivity 상세 조회
  console.log("--- getActivity 상세 ---");
  try {
    const detail = await client.getActivity({ activityId });
    const raw = detail as unknown as Record<string, unknown>;
    console.log("splitSummaries:", JSON.stringify(raw.splitSummaries, null, 2)?.slice(0, 1000));
    console.log("\nlaps/splits 관련 키:", Object.keys(raw).filter(k =>
      k.toLowerCase().includes("split") || k.toLowerCase().includes("lap")
    ));
  } catch (error) {
    console.log("에러:", error instanceof Error ? error.message : error);
  }

  // 2. 커스텀 엔드포인트 시도 (km별 splits)
  const urls = [
    `https://connectapi.garmin.com/activity-service/activity/${activityId}/splits`,
    `https://connectapi.garmin.com/activity-service/activity/${activityId}/details`,
  ];

  for (const url of urls) {
    const short = url.replace("https://connectapi.garmin.com", "");
    console.log(`\n--- ${short} ---`);
    try {
      const result = await client.get(url);
      console.log(JSON.stringify(result, null, 2).slice(0, 2000));
    } catch (error) {
      console.log("에러:", (error instanceof Error ? error.message : String(error)).slice(0, 200));
    }
  }

  resetClient();
}

main();
