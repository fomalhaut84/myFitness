import "dotenv/config";
import { getGarminClient, resetClient } from "../src/lib/garmin/client";

async function main() {
  console.log("=== Garmin Connect 연결 테스트 ===\n");

  try {
    // 1. 로그인
    console.log("1. 로그인 시도...");
    const client = await getGarminClient();
    console.log("   로그인 성공!\n");

    // 2. 프로필 조회
    console.log("2. 사용자 프로필 조회...");
    const profile = await client.getUserProfile();
    console.log(`   이름: ${profile.displayName}`);
    console.log(`   프로필: ${JSON.stringify(profile, null, 2).slice(0, 500)}\n`);

    // 3. 오늘 걸음 수
    console.log("3. 오늘 걸음 수 조회...");
    try {
      const steps = await client.getSteps();
      console.log(`   걸음 수: ${steps.toLocaleString()}\n`);
    } catch {
      console.log("   걸음 수 데이터 없음\n");
    }

    // 4. 최근 활동 1개
    console.log("4. 최근 활동 조회...");
    const activities = await client.getActivities(0, 1);
    if (activities.length > 0) {
      const a = activities[0];
      console.log(`   최근 활동: ${a.activityName}`);
      console.log(`   타입: ${a.activityType?.typeKey}`);
      console.log(`   날짜: ${a.startTimeLocal}`);
    } else {
      console.log("   활동 데이터 없음");
    }

    // 5. 토큰 캐시 확인
    console.log("\n5. 토큰 캐시 확인...");
    const fs = await import("fs");
    const path = await import("path");
    const tokenDir = path.resolve(process.cwd(), ".garmin-tokens");
    if (fs.existsSync(tokenDir)) {
      const files = fs.readdirSync(tokenDir);
      console.log(`   캐시 파일: ${files.join(", ")}`);
    }

    console.log("\n=== 테스트 완료 ===");
  } catch (error) {
    console.error("\n테스트 실패:", error);
    process.exit(1);
  } finally {
    resetClient();
  }
}

main();
