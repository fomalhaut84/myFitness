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
 * 8. Codex 3회차 P2: fallback 타입은 성공 후에만 복원, 시그널은 진행 중 청크를 기다림, 전체 null 지표도 필드 유지
 * 9. Codex 4회차 P2: 선택 타입 중 null 마커가 있으면 --to 는 어제 기준
 * 10. Codex 5회차: P1 타입별 순차 싱크 + 즉시 복원 (옛 lastSyncDate 노출 창 최소화), P2 행 없는 타입도 null 마커
 * 11. Codex 6회차 P2: get_blood_pressure 도 400행 초과 시 집계 승격, coverage 문구가 기록 하한과 fetch 하한을 구분
 * 12. #381 (릴리즈 PR #380 Codex P2): updateSyncMetadata 의 lastSyncDate 단조 증가 — 과거 청크가 커서를 끌어내리지 못함
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
  markersForTypes,
  pickBackfillTo,
  resolveRestoredLastSyncDate,
  restorableTypes,
  stopFailedTypes,
  typesWithoutSuccessfulSync,
} from "../src/lib/garmin/backfill-chunks";
import { ymdKST } from "../src/lib/garmin/utils";
import {
  advanceLastSyncDateWhere,
  clampCursorToToday,
  resolveNextLastSyncDate,
} from "../src/lib/garmin/sync-metadata";

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
// Codex 3회차 P2: 구간 전체가 null 인 지표는 자동 탐지에서 빠져 응답 스키마가 흔들렸다 → fields 명시 시 null 로 유지
const allNull = [
  { date: kst("2026-09-14"), sleepScore: 80, avgSpO2: null },
  { date: kst("2026-09-15"), sleepScore: 70, avgSpO2: null },
];
const withFields = aggregateDaily(allNull, "weekly", { fields: ["sleepScore", "avgSpO2"] });
check("fields 명시: 전체 null 지표도 키 유지 (null)", "avgSpO2" in withFields[0] && withFields[0].avgSpO2 === null && withFields[0].sleepScore === 75, withFields[0]);
check("fields 명시: minMax 도 전체 null 이면 {null,null,null}", JSON.stringify(aggregateDaily(allNull, "weekly", { fields: ["avgSpO2"], minMax: ["avgSpO2"] })[0].avgSpO2) === JSON.stringify({ avg: null, min: null, max: null }));
check("fields 생략(자동 탐지) 은 전체 null 키 생략 — 핸들러는 항상 fields 를 준다", !("avgSpO2" in aggregateDaily(allNull, "weekly")[0]));

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
// Codex 4회차 P2: null 마커가 섞이면 옛 마커 기준 초기화 → 이후 cron 증분과 disjoint → 리셋. 어제 기준으로.
check("null 마커가 섞이면 어제 기준 (옛 마커 무시)", ymdKST(pickBackfillTo([null, kst("2026-04-21"), null], today)) === "2026-09-16");
check("null 없으면 가장 늦은 마커 - 1일", ymdKST(pickBackfillTo([kst("2026-04-21"), kst("2026-04-21")], today)) === "2026-04-20");
// Codex 5회차 P2: 행이 없는 타입은 조회 결과에 없어 null 판정에서 빠졌다 → 타입 기준으로 null 채움
const mk = markersForTypes(["activities", "sleep", "heart_rate"] as const, [
  { dataType: "activities", oldestFetchedDate: kst("2026-04-21") },
  { dataType: "sleep", oldestFetchedDate: null },
]);
check("행 없는 타입은 null 마커", mk.length === 3 && mk[2] === null && mk[1] === null && ymdKST(mk[0]!) === "2026-04-21");
check("행 없는 타입이 섞이면 --to 는 어제", ymdKST(pickBackfillTo(mk, today)) === "2026-09-16");
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
check("스크립트가 lastSyncDate 를 청크마다 복원한다 (finally, 소스 확인)", /finally \{[\s\S]*?await restoreLastSync\(nextState\)/.test(readFileSync(join(__dirname, "backfill-history.ts"), "utf8")));

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
// Codex 6회차 P2: days 상한이 풀린 모든 일별 도구는 행 상한 승격을 가져야 한다
const bpSrc = readFileSync(join(__dirname, "..", "src", "mcp", "tools", "blood-pressure.ts"), "utf8");
check("get_blood_pressure 도 promoteGranularity 를 적용한다 (소스 확인)", /promoteGranularity\("daily", displayDays, displayRecords\.length\)/.test(bpSrc) && /aggregateDaily\(displayRecords/.test(bpSrc));
const coverageSrc = readFileSync(join(__dirname, "..", "src", "mcp", "tools", "coverage.ts"), "utf8");
check("coverage _context 가 기록 하한(oldest)과 fetch 하한(oldestFetched)을 구분한다", /가져왔지만 기록이 없는/.test(coverageSrc) && /min\(oldest, oldestFetched\)/.test(coverageSrc));

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
check("스크립트가 SIGINT/SIGTERM 핸들러를 설치한다 (소스 확인)", /process\.on\(signal/.test(backfillSrc) && /installSignalHandlers\(\)/.test(backfillSrc));
// Codex 3회차 P2: 진행 중 syncAll 과 동시에 복원하면 in-flight updateSyncMetadata 가 나중에 덮어쓴다 → 청크를 기다린 뒤 종료
check("시그널 핸들러가 진행 중 청크(activeChunk)를 기다린다", /\(activeChunk \?\? Promise\.resolve\(\)\)/.test(backfillSrc) && /activeChunk = running/.test(backfillSrc));
check("핸들러는 시그널만으로는 복원을 직접 호출하지 않는다 (청크 finally 가 담당)", !/process\.on\(signal[\s\S]*?restoreLastSync\(/.test(backfillSrc.split("async function snapshotLastSync")[0]));

// --- 9. Codex 3회차 P2: fallback(행 없음/성공 싱크 없음) 타입은 이번 실행에서 성공한 뒤에만 복원.
//   첫 청크가 두 번 다 실패했는데 `to` 로 올리면 다음 증분 싱크가 to+1 부터 시작해 과거가 조용히 빈다.
console.log("\n[9] restorableTypes / typesWithoutSuccessfulSync (Codex 3회차 P2)");
const fb = typesWithoutSuccessfulSync(["activities", "sleep", "heart_rate"] as const, [
  { dataType: "activities", lastSyncDate: kst("2026-09-16") },
  { dataType: "sleep", lastSyncDate: new Date(0) },
]);
check("행 없음 + epoch 행 → fallback 타입", fb.has("sleep") && fb.has("heart_rate") && !fb.has("activities"));
const all = ["activities", "sleep", "heart_rate"] as const;
check("성공 전: 기존 타입만 복원, fallback 은 제외", JSON.stringify(restorableTypes(all, fb, new Set())) === JSON.stringify(["activities"]));
check("sleep 성공 후: sleep 도 복원 대상", JSON.stringify(restorableTypes(all, fb, new Set(["sleep"]))) === JSON.stringify(["activities", "sleep"]));
check("기존 타입은 실패해도 항상 복원 (끌어내린 값 되돌리기)", restorableTypes(all, fb, new Set()).includes("activities"));
check("스크립트가 성공 타입을 succeeded 에 누적한다 (소스 확인)", /succeeded: new Set\(\[\.\.\.state\.succeeded/.test(backfillSrc));
// Codex 5회차 P1: 여러 타입을 한 syncAll 로 돌리면 먼저 끝난 타입의 옛 lastSyncDate 가 수십 분 노출된다
check("청크 안에서 syncAll 은 타입 하나씩 호출한다 (소스 확인)", /dataTypes: \[dataType\]/.test(backfillSrc) && !/dataTypes: \[\.\.\.types\]/.test(backfillSrc));
check("타입 싱크 직후 그 타입만 즉시 복원한다 (소스 확인)", /finally \{\s*await restoreLastSync\(nextState, \[dataType\]\)/.test(backfillSrc));

// --- 12. #381 회귀: updateSyncMetadata 가 lastSyncDate 를 무조건 덮어쓰면 backfill 청크가 커서를 수년 뒤로 끌고,
//     backfill/cron 경쟁 시 cron 전진분이 스냅샷 복원에 지워진다. 단조 증가 predicate + 소스 스캔.
console.log("\n[12] lastSyncDate 단조 증가 (#381)");
{
  const today = kst("2026-09-18");
  const where = advanceLastSyncDateWhere("sleep", today);
  check("predicate: dataType + lastSyncDate < endDate", where.dataType === "sleep" && where.lastSyncDate.lt.getTime() === today.getTime(), where);
  check("과거 청크 end(2020) 는 오늘 커서를 못 끌어내림", resolveNextLastSyncDate(today, kst("2020-05-30")).getTime() === today.getTime());
  check("더 늦은 endDate 는 전진", ymdKST(resolveNextLastSyncDate(kst("2026-09-17"), today)) === "2026-09-18");
  check("같으면 그대로", resolveNextLastSyncDate(today, today).getTime() === today.getTime());
  check("epoch(markError/markSyncing 행) → 첫 성공 endDate 로 전진", resolveNextLastSyncDate(new Date(0), today).getTime() === today.getTime());
  // Codex P1 (PR #386): 미래 endDate 가 커서를 미래로 밀면 단조 증가 때문에 되돌릴 수 없다 → 오늘로 clamp + /api/sync 거부
  check("미래 endDate 는 오늘로 clamp", clampCursorToToday(kst("2027-01-01"), today).getTime() === today.getTime());
  check("오늘/과거 endDate 는 그대로", clampCursorToToday(today, today).getTime() === today.getTime() && ymdKST(clampCursorToToday(kst("2026-09-10"), today)) === "2026-09-10");
  check("clamp 된 커서로 전진 판정 → 미래 endDate 로는 오늘 커서를 넘지 못함", resolveNextLastSyncDate(today, clampCursorToToday(kst("2027-01-01"), today)).getTime() === today.getTime());
  const routeSrc = readFileSync(join(__dirname, "..", "src", "app", "api", "sync", "route.ts"), "utf8");
  check("/api/sync 가 미래 endDate 를 400 으로 거부", /parsed\.getTime\(\) > todayKST\(\)\.getTime\(\)[\s\S]*?status: 400/.test(routeSrc));
  // 사전 리뷰 info 2: markError/markSyncing 의 upsert 도 같은 모양이라 파일 전체에 앵커링하면 함수 순서가 바뀔 때
  // 무증상 통과가 된다 → updateSyncMetadata 함수 본문으로 범위를 좁힌다.
  const syncSrc = readFileSync(join(__dirname, "..", "src", "lib", "garmin", "sync.ts"), "utf8");
  const fnStart = syncSrc.indexOf("async function updateSyncMetadata");
  const fnEnd = syncSrc.indexOf("async function markError");
  check("updateSyncMetadata 함수 범위 추출", fnStart >= 0 && fnEnd > fnStart, { fnStart, fnEnd });
  const fnSrc = syncSrc.slice(fnStart, fnEnd);
  const upsertUpdate = /syncMetadata\.upsert\(\{\s*where: \{ dataType \},\s*update: \{([\s\S]*?)\},\s*create:/.exec(fnSrc)?.[1] ?? "";
  check("updateSyncMetadata upsert update 블록에 lastSyncDate 없음 (무조건 덮어쓰기 재유입 방지)", upsertUpdate.length > 0 && !upsertUpdate.includes("lastSyncDate"), upsertUpdate.trim().slice(0, 120));
  check("updateSyncMetadata 가 clamp 된 cursor 로 advanceLastSyncDateWhere 조건부 전진", /const cursor = clampCursorToToday\(endDate, todayKST\(\)\);[\s\S]*?updateMany\(\{\s*where: advanceLastSyncDateWhere\(dataType, cursor\),\s*data: \{ lastSyncDate: cursor \}/.test(fnSrc));
  check("create 경로도 clamp", /lastSyncDate: clampCursorToToday\(endDate, todayKST\(\)\)/.test(fnSrc));
}

if (failed > 0) {
  console.error(`\n❌ ${failed}건 실패`);
  process.exit(1);
}
console.log("\n✅ verify-mcp-long-history 통과");
