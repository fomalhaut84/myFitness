/**
 * #377 회귀 검증 — MCP 장기 조회.
 *
 * 1. aggregate.ts: KST 주/월 버킷 경계, null 제외 평균, min/max, 활동 거리·시간 가중
 * 2. resolveGranularity 자동 임계 (120/121, 730/731)
 * 3. backfill 청크: 최신→과거 순, 365일, 경계 포함, 마지막 청크가 from 에서 끊김
 * 4. 소스 스캔: src/mcp/** 에 `.max(365)` / `Math.min(365` 리터럴 재유입 0건
 *    (상한을 상수(MAX_QUERY_DAYS)로 우회 없이 되돌리는 회귀를 잡는다)
 * 5. 사전 리뷰 회귀 (8-5): C1 lastSyncDate 복원, M1 --to 기본값은 가장 늦은 마커, M2 daily 행 상한 승격
 * 6. Codex 회귀 (PR #379): P1 행 없는 타입의 스냅샷 fallback, P2 실패 타입은 이후 청크에서 멈춤
 * 7. Codex 2회차: P1 server.ts 등록 도구 ⊆ claude-advisor allowlist (mutating 제외), P1 endDate 창, P2 시그널 복원
 *
 * 실행: npm run verify:mcp-long-history
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateActivities,
  aggregateDaily,
  bucketKeyKST,
  kstWindowEndingAt,
  promoteGranularity,
  resolveGranularity,
  weekStartFromKey,
  weekStartKST,
} from "../src/mcp/tools/aggregate";
import {
  AUTO_MONTHLY_THRESHOLD_DAYS,
  AUTO_WEEKLY_THRESHOLD_DAYS,
  MAX_DAILY_ROWS,
  MAX_QUERY_DAYS,
} from "../src/mcp/tools/constants";
import {
  buildBackfillChunks,
  buildLastSyncSnapshot,
  pickBackfillTo,
  resolveRestoredLastSyncDate,
  stopFailedTypes,
} from "../src/lib/garmin/backfill-chunks";
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
check("weekStartFromKey 2026-W38 → 2026-09-14", weekStartFromKey("2026-W38") === "2026-09-14");
check("weekStartFromKey 2026-W01 → 2025-12-29 (연도 넘김)", weekStartFromKey("2026-W01") === "2025-12-29");
check("weekStartFromKey 2022-W52 → 2022-12-26", weekStartFromKey("2022-W52") === "2022-12-26");

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
check("weekly 행에 weekStart (I1)", w38.weekStart === "2026-09-14" && weekly[0].weekStart === "2026-09-21", weekly.map((w) => w.weekStart));
check("monthly 행엔 weekStart 없음", !("weekStart" in aggregateDaily(daily, "monthly")[0]));
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
check("활동 weekly 행에도 weekStart", run.weekStart === "2026-09-14");

// --- 4. resolveGranularity
console.log("\n[4] resolveGranularity");
check(`≤${AUTO_WEEKLY_THRESHOLD_DAYS} daily`, resolveGranularity(AUTO_WEEKLY_THRESHOLD_DAYS) === "daily");
check(`${AUTO_WEEKLY_THRESHOLD_DAYS + 1} weekly`, resolveGranularity(AUTO_WEEKLY_THRESHOLD_DAYS + 1) === "weekly");
check(`${AUTO_MONTHLY_THRESHOLD_DAYS} weekly`, resolveGranularity(AUTO_MONTHLY_THRESHOLD_DAYS) === "weekly");
check(`${AUTO_MONTHLY_THRESHOLD_DAYS + 1} monthly`, resolveGranularity(AUTO_MONTHLY_THRESHOLD_DAYS + 1) === "monthly");
check("명시 granularity 우선", resolveGranularity(3000, "daily") === "daily");
check("MAX_QUERY_DAYS 는 365 보다 크다 (상한 해제)", MAX_QUERY_DAYS > 365);

// --- 4b. M2: daily 행 상한 승격 (사전 리뷰 major — 명시 daily + 큰 days 로 수천 행이 컨텍스트에 실림)
console.log("\n[4b] promoteGranularity (M2)");
check(`daily ${MAX_DAILY_ROWS}행 → 유지`, JSON.stringify(promoteGranularity("daily", 3000, MAX_DAILY_ROWS)) === JSON.stringify({ granularity: "daily", promoted: false }));
check(`daily ${MAX_DAILY_ROWS + 1}행 · days>730 → monthly 승격`, JSON.stringify(promoteGranularity("daily", 3000, MAX_DAILY_ROWS + 1)) === JSON.stringify({ granularity: "monthly", promoted: true }));
check(`daily ${MAX_DAILY_ROWS + 1}행 · days≤730 → weekly 승격`, JSON.stringify(promoteGranularity("daily", 600, MAX_DAILY_ROWS + 1)) === JSON.stringify({ granularity: "weekly", promoted: true }));
check("weekly 요청은 행 수와 무관하게 유지", JSON.stringify(promoteGranularity("weekly", 3000, 5000)) === JSON.stringify({ granularity: "weekly", promoted: false }));
check("행 0 → 유지", promoteGranularity("daily", 3000, 0).promoted === false);

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

// --- 5b. M1: --to 기본값은 oldestFetchedDate 중 가장 **늦은** 값 - 1일
//   병합 조건 endDate >= oldestFetchedDate-1 이라 가장 이른 값을 쓰면 늦은 타입은 disjoint 로 무시된다.
console.log("\n[5b] pickBackfillTo (M1)");
const today = kst("2026-09-17");
check("가장 늦은 마커 - 1일 (이른 값 아님)", ymdKST(pickBackfillTo([kst("2025-01-01"), kst("2026-04-01")], today)) === "2026-03-31");
check("null 은 무시", ymdKST(pickBackfillTo([null, kst("2026-04-21"), null], today)) === "2026-04-20");
check("마커 전무 → 어제", ymdKST(pickBackfillTo([null, null], today)) === "2026-09-16");
check("빈 배열 → 어제", ymdKST(pickBackfillTo([], today)) === "2026-09-16");
// 병합 조건 재현: 늦은 마커 기준 to 는 모든 타입에 대해 endDate >= oldest-1 을 만족
const to = pickBackfillTo([kst("2025-01-01"), kst("2026-04-01")], today);
check("모든 타입에 대해 첫 청크가 인접/중첩", [kst("2025-01-01"), kst("2026-04-01")].every((o) => to.getTime() >= o.getTime() - 86400000));

// --- 5c. C1: lastSyncDate 는 backfill 대상이 아니다 — 스냅샷보다 뒤로 가지 않는다
//   syncAll 이 lastSyncDate=endDate 를 무조건 덮어써 최신→과거 backfill 후 2020 년으로 남으면
//   weekly-report 의 startDate 없는 syncAll 이 lastSyncDate+1 부터 수년치를 재싱크한다.
console.log("\n[5c] resolveRestoredLastSyncDate (C1)");
const snap = kst("2026-09-16");
check("청크가 끌어내린 값(2020) → 스냅샷으로 복원", ymdKST(resolveRestoredLastSyncDate(snap, kst("2020-05-30"))) === "2026-09-16");
check("그 사이 cron 이 더 늦게 썼으면 유지", ymdKST(resolveRestoredLastSyncDate(snap, kst("2026-09-17"))) === "2026-09-17");
check("동일하면 그대로", resolveRestoredLastSyncDate(snap, kst("2026-09-16")).getTime() === snap.getTime());
check("스크립트가 lastSyncDate 를 청크마다 복원한다 (소스 확인)", /restoreLastSync\(snapshot\)/.test(readFileSync(join(__dirname, "backfill-history.ts"), "utf8")));

// --- 5d. Codex P1 (PR #379): SyncMetadata 행이 없는 타입은 스냅샷에서 빠져 첫 청크가 만든 행을
//   이후 청크가 계속 과거로 끌어내렸다. 행 없음/성공 싱크 없음(epoch 0) → `to` 를 기준으로.
console.log("\n[5d] buildLastSyncSnapshot (Codex P1)");
const toBoundary = kst("2026-04-20");
const snapRows = [
  { dataType: "activities", lastSyncDate: kst("2026-09-16") },
  { dataType: "sleep", lastSyncDate: new Date(0) }, // markError 만 만든 행
];
const snapMap = buildLastSyncSnapshot(["activities", "sleep", "heart_rate"] as const, snapRows, toBoundary);
check("행 있는 타입은 자기 lastSyncDate", ymdKST(snapMap.get("activities")!) === "2026-09-16");
check("행 없는 타입 → to 기준", ymdKST(snapMap.get("heart_rate")!) === "2026-04-20");
check("epoch(0) 행(성공 싱크 없음) → to 기준", ymdKST(snapMap.get("sleep")!) === "2026-04-20");
check("선택 타입 전부 포함 (누락 0)", snapMap.size === 3);
// 복원 시나리오: 첫 청크가 만든 행이 이후 청크에 의해 2020 으로 끌려도 to 로 복원
check("행 없던 타입도 과거로 끌린 값이 to 로 복원", ymdKST(resolveRestoredLastSyncDate(snapMap.get("heart_rate")!, kst("2020-05-30"))) === "2026-04-20");

// --- 5e. Codex P2 (PR #379): 재시도까지 실패한 타입은 더 오래된 청크에서 멈춘다 (마커 복구 불가 방지)
console.log("\n[5e] stopFailedTypes (Codex P2)");
const activeBefore = ["daily_stats", "sleep", "heart_rate"] as const;
const activeAfter = stopFailedTypes(activeBefore, ["sleep"]);
check("실패 타입 제거", JSON.stringify(activeAfter) === JSON.stringify(["daily_stats", "heart_rate"]));
check("입력 불변", activeBefore.length === 3);
check("실패 없음 → 그대로", stopFailedTypes(activeBefore, []).length === 3);
check("전부 실패 → 빈 배열 (루프 중단)", stopFailedTypes(activeBefore, [...activeBefore]).length === 0);
check("스크립트가 실패 타입을 active 에서 제거한다 (소스 확인)", /active = stopFailedTypes\(active, failed\)/.test(readFileSync(join(__dirname, "backfill-history.ts"), "utf8")));

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

// --- 7. Codex 2회차 P1: 새 MCP 도구가 어드바이저 allowlist 에 없으면 -p 비대화형에서 호출 불가
console.log("\n[7] server.ts 등록 도구 ⊆ claude-advisor allowlist");
const serverSrc = readFileSync(join(__dirname, "..", "src", "mcp", "server.ts"), "utf8");
const advisorSrc = readFileSync(join(__dirname, "..", "src", "lib", "ai", "claude-advisor.ts"), "utf8");
const registered = [...serverSrc.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
const allowed = new Set([...advisorSrc.matchAll(/mcp__myfitness__([a-z_]+)/g)].map((m) => m[1]));
const MUTATING = new Set(["generate_training_plan"]); // 의도적으로 allowlist 제외 (claude-advisor.ts 주석)
const missing = registered.filter((t) => !MUTATING.has(t) && !allowed.has(t));
check(`등록 도구 ${registered.length}개 파싱됨 (get_data_coverage 포함)`, registered.length >= 22 && registered.includes("get_data_coverage"));
check("read-only 도구 전부 allowlist 에 있음", missing.length === 0, missing);
check("mutating 도구는 allowlist 에 없음", ![...MUTATING].some((t) => allowed.has(t)));

// --- 8. Codex 2회차 P1: 과거 시기 daily drill-down 용 endDate 창
console.log("\n[8] kstWindowEndingAt (endDate)");
const win = kstWindowEndingAt(30, "2025-06-15");
check("until = endDate 다음 KST 자정 (exclusive)", win.until.toISOString() === "2025-06-15T15:00:00.000Z");
check("since = endDate - days (daysAgo 와 같은 의미)", ymdKST(win.since) === "2025-05-16");
check("endDate 당일 23:59 KST 는 창 안", kst("2025-06-15", "23:59:59") < win.until);
check("endDate 다음날 00:00 KST 는 창 밖", !(kst("2025-06-16") < win.until));
let threw = false; try { kstWindowEndingAt(30, "2025-02-30"); } catch { threw = true; }
check("무효 날짜(2025-02-30) 는 throw", threw);
threw = false; try { kstWindowEndingAt(30, "20250615"); } catch { threw = true; }
check("형식 불일치는 throw", threw);
const backfillSrc = readFileSync(join(__dirname, "backfill-history.ts"), "utf8");
check("스크립트가 SIGINT/SIGTERM 에서 스냅샷을 복원한다 (소스 확인)", /process\.once\(signal/.test(backfillSrc) && /installSignalHandlers\(\)/.test(backfillSrc));

if (failed > 0) {
  console.error(`\n❌ ${failed}건 실패`);
  process.exit(1);
}
console.log("\n✅ verify-mcp-long-history 통과");
