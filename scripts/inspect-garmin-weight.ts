// #328: Garmin weight API endDate 계약 관찰용. 로컬에서 실행:
//   npx tsx scripts/inspect-garmin-weight.ts
// 요구: .env 의 GARMIN_EMAIL / GARMIN_PASSWORD 세팅.
// 목적: 오늘 재고 앱에 반영된 체중이 응답에 포함되는 endDate 값 확정.

import "dotenv/config";
import { GarminConnect } from "@flow-js/garmin-connect";
import { ymdKST, todayKST } from "@/lib/garmin/utils";

const WEIGHT_URL = "https://connectapi.garmin.com/weight-service/weight/dateRange";
const DAY_MS = 24 * 60 * 60 * 1000;

interface Entry {
  date: number;
  weight: number;
  sourceType?: string;
}
interface Response {
  dateWeightList: Entry[];
}

function fmt(d: Date): string {
  return ymdKST(d);
}

async function main() {
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!email || !password) {
    console.error("GARMIN_EMAIL / GARMIN_PASSWORD 환경변수 필요");
    process.exit(1);
  }

  const client = new GarminConnect({ username: email, password });
  await client.login();
  console.log("Garmin login OK");

  const today = todayKST();
  const start = new Date(today.getTime() - 3 * DAY_MS);

  const cases = [
    { label: "endDate = 오늘 KST date", end: today },
    { label: "endDate = 오늘 + 1일 (내일)", end: new Date(today.getTime() + DAY_MS) },
    { label: "endDate = 오늘 + 2일", end: new Date(today.getTime() + 2 * DAY_MS) },
  ];

  for (const c of cases) {
    const url = `${WEIGHT_URL}?startDate=${fmt(start)}&endDate=${fmt(c.end)}`;
    console.log(`\n=== ${c.label} ===\n  URL: ${url}`);
    try {
      const res = await client.get<Response>(url);
      const list = res?.dateWeightList ?? [];
      console.log(`  count: ${list.length}`);
      for (const e of list) {
        const d = new Date(e.date);
        console.log(
          `    - date=${fmt(d)} (${d.toISOString()}) weight=${e.weight}g source=${e.sourceType ?? "?"}`,
        );
      }
    } catch (err) {
      console.log(`  ERR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
