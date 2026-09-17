/**
 * #377 회귀 검증 — MCP 장기 조회.
 *
 * 1. aggregate.ts: KST 주/월 버킷 경계, null 제외 평균, min/max, 활동 거리·시간 가중
 * 2. resolveGranularity 자동 임계 (120/121, 730/731)
 * 3. backfill 청크: 최신→과거 순, 365일, 경계 포함, 마지막 청크가 from 에서 끊김
 * 4. 소스 스캔: src/mcp/** 에 `.max(365)` / `Math.min(365` 리터럴 재유입 0건
 *    (상한을 상수(MAX_QUERY_DAYS)로 우회 없이 되돌리는 회귀를 잡는다)
 *
 * 실행: npm run verify:mcp-long-history
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateActivities,
  aggregateDaily,
  bucketKeyKST,
  resolveGranularity,
  weekStartKST,
} from "../src/mcp/tools/aggregate";
import {
  AUTO_MONTHLY_THRESHOLD_DAYS,
  AUTO_WEEKLY_THRESHOLD_DAYS,
  MAX_QUERY_DAYS,
} from "../src/mcp/tools/constants";
import { buildBackfillChunks } from "../src/lib/garmin/backfill-chunks";
import { ymdKST } from "../src/lib/garmin/utils";

let failed = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`, detail === undefined ? "" : JSON.stringify(detail));
    failed++;
  }
}
const kst = (ymd: string, time = "00:00:00") => new Date(`${ymd}T${time}+09:00`);

// --- 1. 버킷 라벨 (KST · ISO 주)
console.log("\n[1] 버킷 라벨");
// 2026-09-16T15:00Z = KST 2026-09-17 00:00 → 라벨은 KST 날짜
const kstBoundary = new Date("2026-09-16T15:00:00Z");
check("daily 라벨은 KST 날짜", bucketKeyKST(kstBoundary, "daily") === "2026-09-17");
check("monthly 라벨은 KST 월", bucketKeyKST(kstBoundary, "monthly") === "2026-09");
check("2026-09-17(목) ISO 주", bucketKeyKST(kstBoundary, "weekly") === "2026-W38");
check("2025-12-29(월) → 2026-W01", bucketKeyKST(kst("2025-12-29"), "weekly") === "2026-W01");
check("2026-01-01(목) → 2026-W01", bucketKeyKST(kst("2026-01-01"), "weekly") === "2026-W01");
check("2023-01-01(일) → 2022-W52", bucketKeyKST(kst("2023-01-01"), "weekly") === "2022-W52");
check("2024-12-30(월) → 2025-W01", bucketKeyKST(kst("2024-12-30"), "weekly") === "2025-W01");
check("weekStartKST 일요일 → 그 주 월요일", weekStartKST(kst("2026-09-20")) === "2026-09-14");
check("weekStartKST 월요일 → 자기 자신", weekStartKST(kst("2026-09-14")) === "2026-09-14");

// --- 2. aggregateDaily
console.log("\n[2] aggregateDaily");
const daily = [
  { date: kst("2026-09-14"), weight: 80, bodyFat: 20, note: "a" },
  { date: kst("2026-09-15"), weight: 82, bodyFat: null, note: "b" },
  { date: kst("2026-09-21"), weight: 78, bodyFat: 19, note: "c" },
];
const weekly = aggregateDaily(daily, "weekly", { minMax: ["weight"] });
check("주 2개, 최신순", weekly.length === 2 && weekly[0].bucket === "2026-W39" && weekly[1].bucket === "2026-W38", weekly.map((w) => w.bucket));
const w38 = weekly[1];
check("count = 레코드 수", w38.count === 2);
check("from/to = 버킷 내 실제 날짜", w38.from === "2026-09-14" && w38.to === "2026-09-15");
check("minMax 필드 {avg,min,max}", JSON.stringify(w38.weight) === JSON.stringify({ avg: 81, min: 80, max: 82 }), w38.weight);
check("null 은 평균에서 제외", w38.bodyFat === 20, w38.bodyFat);
check("문자열 필드는 집계 제외", !("note" in w38));
check("입력 불변", daily[1].bodyFat === null && daily.length === 3);
const monthly = aggregateDaily(daily, "monthly");
check("monthly 단일 버킷 avg 소수 1자리", monthly.length === 1 && monthly[0].weight === 80 && monthly[0].bodyFat === 19.5, monthly[0]);
check("빈 입력 → 빈 배열", aggregateDaily([], "weekly").length === 0);

// --- 3. aggregateActivities
console.log("\n[3] aggregateActivities");
const acts = [
  { activityType: "running", startTime: kst("2026-09-14", "06:00:00"), distance: 10000, duration: 3000, avgHR: 150, vo2maxEstimate: 45 },
  { activityType: "running", startTime: kst("2026-09-16", "06:00:00"), distance: 5000, duration: 1200, avgHR: 160, vo2maxEstimate: null },
  { activityType: "strength", startTime: kst("2026-09-16", "19:00:00"), distance: null, duration: 1800, avgHR: null, vo2maxEstimate: null },
];
const aw = aggregateActivities(acts, "weekly");
check("버킷 × 타입 분리 (running, strength)", aw.length === 2 && aw.some((r) => r.activityType === "running") && aw.some((r) => r.activityType === "strength"));
const run = aw.find((r) => r.activityType === "running")!;
check("거리 합 15.00km", run.totalDistanceKm === 15);
// 거리 가중 페이스: 4200s / 15km = 280 s/km (단순 평균 (300+240)/2=270 이 아님)
check("avgPace 거리 가중 280s/km", run.avgPaceSecKm === 280 && run.avgPaceMinKm === "4'40\"", run);
// 시간 가중 HR: (150*3000+160*1200)/4200 = 152.86 → 153
check("avgHR 시간 가중 153", run.avgHR === 153, run.avgHR);
check("longestKm 10", run.longestKm === 10);
check("vo2max null 제외 평균", run.avgVo2maxEstimate === 45);
const st = aw.find((r) => r.activityType === "strength")!;
check("거리 없는 타입 pace/longest null", st.avgPaceSecKm === null && st.longestKm === null && st.totalDurationMin === 30);

// --- 4. resolveGranularity
console.log("\n[4] resolveGranularity");
check(`≤${AUTO_WEEKLY_THRESHOLD_DAYS} daily`, resolveGranularity(AUTO_WEEKLY_THRESHOLD_DAYS) === "daily");
check(`${AUTO_WEEKLY_THRESHOLD_DAYS + 1} weekly`, resolveGranularity(AUTO_WEEKLY_THRESHOLD_DAYS + 1) === "weekly");
check(`${AUTO_MONTHLY_THRESHOLD_DAYS} weekly`, resolveGranularity(AUTO_MONTHLY_THRESHOLD_DAYS) === "weekly");
check(`${AUTO_MONTHLY_THRESHOLD_DAYS + 1} monthly`, resolveGranularity(AUTO_MONTHLY_THRESHOLD_DAYS + 1) === "monthly");
check("명시 granularity 우선", resolveGranularity(3000, "daily") === "daily");
check("MAX_QUERY_DAYS 는 365 보다 크다 (상한 해제)", MAX_QUERY_DAYS > 365);

// --- 5. backfill 청크
console.log("\n[5] backfill 청크");
const chunks = buildBackfillChunks(kst("2019-06-01"), kst("2026-04-20"));
check("첫 청크가 최신 (to 에서 시작)", ymdKST(chunks[0].end) === "2026-04-20" && ymdKST(chunks[0].start) === "2025-04-21", chunks[0]);
check("두 번째 청크는 첫 청크 start-1 에서 끝남 (인접)", ymdKST(chunks[1].end) === "2025-04-20");
const last = chunks[chunks.length - 1];
check("마지막 청크는 from 에서 끊김", ymdKST(last.start) === "2019-06-01" && last.start <= last.end, last);
check("청크 수 = ceil(일수/365)", chunks.length === Math.ceil(((kst("2026-04-20").getTime() - kst("2019-06-01").getTime()) / 86400000 + 1) / 365), chunks.length);
check("청크 간 빈틈·중첩 없음", chunks.every((c, i) => i === 0 || c.end.getTime() === chunks[i - 1].start.getTime() - 86400000));
check("from == to → 하루짜리 청크 1개", buildBackfillChunks(kst("2026-01-01"), kst("2026-01-01")).length === 1);
check("from > to → 청크 0개", buildBackfillChunks(kst("2026-01-02"), kst("2026-01-01")).length === 0);

// --- 6. 소스 스캔
console.log("\n[6] 소스 스캔 (src/mcp/**)");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const offenders: string[] = [];
for (const file of walk(join(__dirname, "..", "src", "mcp"))) {
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (/\.max\(365\)/.test(line) || /Math\.min\(365\b/.test(line)) {
      offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
}
check("`.max(365)` / `Math.min(365` 리터럴 0건", offenders.length === 0, offenders);

if (failed > 0) {
  console.error(`\n❌ ${failed}건 실패`);
  process.exit(1);
}
console.log("\n✅ verify-mcp-long-history 통과");
