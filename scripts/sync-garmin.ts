import "dotenv/config";
import { getGarminClient, resetClient } from "../src/lib/garmin/client";
import { syncAll } from "../src/lib/garmin/sync";

async function main() {
  const args = process.argv.slice(2);
  const daysFlag = args.find((a) => a.startsWith("--days="));
  const days = daysFlag ? parseInt(daysFlag.split("=")[1]) : undefined;

  console.log("=== Garmin 데이터 싱크 ===\n");

  // 연결 확인
  console.log("1. Garmin Connect 로그인...");
  await getGarminClient();
  console.log("   로그인 성공!\n");

  // 싱크 실행
  console.log("2. 데이터 싱크 시작...\n");

  const options = days
    ? {
        startDate: (() => {
          const d = new Date();
          d.setDate(d.getDate() - days);
          d.setHours(0, 0, 0, 0);
          return d;
        })(),
      }
    : undefined;

  const results = await syncAll(options);

  // 결과 요약
  console.log("\n=== 싱크 결과 ===");
  for (const r of results) {
    const status = r.error ? `실패: ${r.error}` : `${r.synced}건`;
    console.log(`  ${r.dataType}: ${status}`);
  }

  const total = results.reduce((sum, r) => sum + r.synced, 0);
  const failed = results.filter((r) => r.error).length;
  console.log(`\n총 ${total}건 싱크, ${failed}건 실패`);

  resetClient();
}

main().catch((error) => {
  console.error("싱크 실패:", error);
  process.exit(1);
});
