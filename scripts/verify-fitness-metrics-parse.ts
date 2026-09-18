/**
 * #378 회귀 검증 — Garmin VO2max · 젖산역치 이력 파서 (F6).
 *
 * 1. 속도 → 페이스 변환 (×10 = m/s 규칙, user-profile 과 동일. 실측 5:21/km)
 * 2. 날짜 KST: calendarDate/from 문자열 → KST 자정 instant, 시각 포함 문자열도 날짜만, 무효 날짜 거부
 * 3. 희소 LT 병합: VO2max 매일 + LT 감지일만 → 날짜 키 병합, 값 없는 날 제외, 미래 날짜 가드, 정렬
 * 4. 청크 분할: 365일 경계 (365 → 1청크, 366 → 2청크), 인접·양끝 포함, 역순 범위는 빈 배열
 * 5. 응답 경계: 배열 아님 → 빈 배열
 * 6. 소스 스캔: DataType/SYNC_ORDER(user_profile 앞)/VALID_DATA_TYPES/backfill 타입/advisor allowlist 에 등록
 *
 * 실행: npm run verify:fitness-metrics-parse
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FITNESS_METRICS_CHUNK_DAYS,
  asRowArray,
  calendarDateOf,
  kstMidnight,
  ltSpeedToPaceSec,
  mergeFitnessMetrics,
  splitDateRange,
} from "../src/lib/garmin/parse-fitness-metrics";
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
const kst = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`);

// --- 1. 속도 → 페이스
console.log("\n[1] ltSpeedToPaceSec");
// user-profile.ts 검증 사례: 5:21/km = 321 s/km ↔ 3.115 m/s ↔ Garmin 값 0.3115
check("0.3115 → 321 s/km (5'21\")", ltSpeedToPaceSec(0.3115) === 321, ltSpeedToPaceSec(0.3115));
check("0.25 → 400 s/km (6'40\")", ltSpeedToPaceSec(0.25) === 400);
check("0 → null", ltSpeedToPaceSec(0) === null);
check("음수 → null", ltSpeedToPaceSec(-1) === null);
check("null/undefined/NaN 문자열 → null", ltSpeedToPaceSec(null) === null && ltSpeedToPaceSec(undefined) === null && ltSpeedToPaceSec("abc") === null);
check("문자열 숫자도 허용", ltSpeedToPaceSec("0.3115") === 321);

// --- 2. 날짜 KST
console.log("\n[2] 날짜 파싱 (KST)");
check("YYYY-MM-DD 그대로", calendarDateOf("2024-03-10") === "2024-03-10");
check("시각 포함 문자열은 날짜만", calendarDateOf("2024-03-10T00:00:00.0") === "2024-03-10");
check("2월 30일 거부", calendarDateOf("2024-02-30") === null);
check("형식 불일치 거부", calendarDateOf("10/03/2024") === null && calendarDateOf(20240310) === null && calendarDateOf(null) === null);
const midnight = kstMidnight("2024-03-10");
check("kstMidnight 은 KST 자정 instant (UTC 전날 15:00)", midnight.toISOString() === "2024-03-09T15:00:00.000Z");
check("kstMidnight → ymdKST 왕복", ymdKST(midnight) === "2024-03-10");

// --- 3. 희소 LT 병합
console.log("\n[3] mergeFitnessMetrics");
const maxmet = [
  { generic: { calendarDate: "2024-03-10", vo2MaxPreciseValue: 52.3, vo2MaxValue: 52, fitnessAge: 30 }, cycling: null },
  { generic: { calendarDate: "2024-03-11", vo2MaxPreciseValue: null, vo2MaxValue: 52, fitnessAge: null } },
  { generic: { calendarDate: "2024-03-12", vo2MaxPreciseValue: null, vo2MaxValue: null, fitnessAge: null } }, // 값 없음 → 제외
  { generic: null }, // 날짜 없음 → 무시
  { generic: { calendarDate: "2099-01-01", vo2MaxPreciseValue: 60 } }, // 미래 → after 가드
];
const lthr = [
  { from: "2024-03-11", until: "2024-03-11", series: "running", value: 172, updatedDate: "2024-03-11T10:00:00.0" },
  { from: "2024-03-20", until: "2024-03-20", series: "running", value: 170 },
];
const ltSpeed = [
  { from: "2024-03-11", until: "2024-03-11", series: "running", value: 0.3115 },
  { from: "2024-03-20", until: "2024-03-20", series: "running", value: 0.32 },
];
const merged = mergeFitnessMetrics(maxmet, lthr, ltSpeed, { after: "2026-09-18" });
check("값 있는 날짜만 · 오름차순 (03-10, 03-11, 03-20)", merged.map((m) => m.date).join(",") === "2024-03-10,2024-03-11,2024-03-20", merged.map((m) => m.date));
const d10 = merged[0], d11 = merged[1], d20 = merged[2];
check("03-10: precise 우선 52.3 · fitnessAge 30 · LT 없음(null)", d10.vo2maxRunning === 52.3 && d10.fitnessAge === 30 && d10.lthr === null && d10.lthrPace === null, d10);
check("03-11: precise null → vo2MaxValue 52 폴백 · LT HR 172 · 페이스 321 (한 row 병합)", d11.vo2maxRunning === 52 && d11.lthr === 172 && d11.lthrPace === 321, d11);
check("03-20: VO2max 없는 감지일 → vo2 null · LT 만", d20.vo2maxRunning === null && d20.lthr === 170 && d20.lthrPace === 313, d20);
check("rawData 는 소스별 원본 보존", d11.rawData.maxmet?.generic?.calendarDate === "2024-03-11" && d11.rawData.lthr?.value === 172 && d11.rawData.ltSpeed?.value === 0.3115 && d10.rawData.lthr === undefined);
check("전부 null 인 03-12 제외", !merged.some((m) => m.date === "2024-03-12"));
check("미래 날짜(2099) 제외", !merged.some((m) => m.date === "2099-01-01"));
check("after 생략 시 미래 포함 (가드는 호출부 책임)", mergeFitnessMetrics(maxmet, [], []).some((m) => m.date === "2099-01-01"));
check("빈 입력 → 빈 배열", mergeFitnessMetrics([], [], []).length === 0);
check("입력 불변", maxmet.length === 5 && lthr[0].value === 172);
// 스펙 §4.3: LT `from` 을 키로 쓴다 — until 만 있고 from 없는 row 는 무시
check("from 없는 LT row 무시", mergeFitnessMetrics([], [{ until: "2024-03-11", value: 170 }], []).length === 0);

// --- 4. 청크 분할
console.log("\n[4] splitDateRange (365일 경계)");
const one = splitDateRange(kst("2025-01-01"), kst("2025-12-31"));
check(`365일 → 1청크 (CHUNK=${FITNESS_METRICS_CHUNK_DAYS})`, one.length === 1 && ymdKST(one[0].start) === "2025-01-01" && ymdKST(one[0].end) === "2025-12-31", one.map((c) => [ymdKST(c.start), ymdKST(c.end)]));
const two = splitDateRange(kst("2024-01-01"), kst("2024-12-31")); // 윤년 366일
check("366일 → 2청크, 첫 청크 365일, 둘째는 마지막 날 하루", two.length === 2 && ymdKST(two[0].end) === "2024-12-30" && ymdKST(two[1].start) === "2024-12-31" && ymdKST(two[1].end) === "2024-12-31", two.map((c) => [ymdKST(c.start), ymdKST(c.end)]));
const seven = splitDateRange(kst("2020-06-01"), kst("2026-09-18"));
check("2020-06-01 ~ 2026-09-18 → 7청크, 인접·연속", seven.length === 7 && seven.every((c, i) => i === 0 || c.start.getTime() === seven[i - 1].end.getTime() + 86400000) && ymdKST(seven[6].end) === "2026-09-18", seven.length);
check("각 청크 폭 ≤ 365일", seven.every((c) => (c.end.getTime() - c.start.getTime()) / 86400000 + 1 <= FITNESS_METRICS_CHUNK_DAYS));
check("하루 범위 → 1청크 (start == end)", splitDateRange(kst("2026-09-18"), kst("2026-09-18")).length === 1);
check("역순 범위 → 빈 배열", splitDateRange(kst("2026-09-18"), kst("2026-09-17")).length === 0);
check("KST 자정이 아닌 instant 도 KST 날짜로 정규화", ymdKST(splitDateRange(new Date("2026-09-17T20:00:00Z"), new Date("2026-09-18T20:00:00Z"))[0].start) === "2026-09-18");
check("maxDays=10 로 30일 → 3청크", splitDateRange(kst("2026-01-01"), kst("2026-01-30"), 10).length === 3);

// --- 5. 응답 경계
console.log("\n[5] asRowArray");
check("배열은 그대로", asRowArray([1, 2]).length === 2);
check("객체/문자열/null/undefined → 빈 배열", asRowArray({}).length === 0 && asRowArray("x").length === 0 && asRowArray(null).length === 0 && asRowArray(undefined).length === 0);

// --- 6. 소스 스캔: 등록 누락 회귀
console.log("\n[6] 등록 스캔");
const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const syncSrc = read("src", "lib", "garmin", "sync.ts");
check("sync.ts DataType 에 fitness_metrics", /\|\s*"fitness_metrics"/.test(syncSrc));
const order = /const SYNC_ORDER: DataType\[\] = \[([\s\S]*?)\];/.exec(syncSrc)?.[1] ?? "";
const orderList = [...order.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
check("SYNC_ORDER 에 fitness_metrics 가 user_profile 앞", orderList.indexOf("fitness_metrics") >= 0 && orderList.indexOf("fitness_metrics") < orderList.indexOf("user_profile"), orderList);
check("SYNC_FNS 에 syncFitnessMetrics", /fitness_metrics:\s*syncFitnessMetrics/.test(syncSrc));
check("firstRecordDate finder 에 fitnessMetricDaily", /fitness_metrics:\s*\(\)\s*=>\s*prisma\.fitnessMetricDaily/.test(syncSrc));
check("/api/sync VALID_DATA_TYPES 에 fitness_metrics", /"fitness_metrics"/.test(read("src", "app", "api", "sync", "route.ts")));
check("backfill-history BACKFILL_TYPES 에 fitness_metrics", /"fitness_metrics"/.test(read("scripts", "backfill-history.ts")));
check("claude-advisor allowlist 에 get_fitness_metric_trend", read("src", "lib", "ai", "claude-advisor.ts").includes("mcp__myfitness__get_fitness_metric_trend"));
check("server.ts 에 get_fitness_metric_trend 등록", /server\.tool\(\s*"get_fitness_metric_trend"/.test(read("src", "mcp", "server.ts")));
check("get_data_coverage 에 fitness_metrics 범위", /fitness_metrics:\s*toRange/.test(read("src", "mcp", "tools", "coverage.ts")));

console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
