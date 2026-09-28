/**
 * #383 회귀 검증 — 워치 미착용 날의 빈 Garmin 응답을 stub 으로 저장하지 않는다.
 *
 * 1. isEmptyDailySummary: 2019-08-01 실측 stub(핵심 지표 전부 null) → 빈 날, 걸음만 있어도 저장, 0 도 null 취급
 * 2. isPrivacyProtected: true 만 이상 (false/undefined 는 정상)
 * 3. isEmptyHeartRate: restingHeartRate null + heartRateValues null/[] → 빈 날, 값이 하나라도 있으면 저장
 * 4. cleanup where 빌더: 삭제 조건은 skip 조건보다 엄격 (핵심 4개 + 나머지 지표·밸런스 컬럼 전부 null), HR 은 hrvBaseline 까지
 * 5. 소스 스캔: daily-summary.ts 가 isPrivacyProtected → throw (calendarDate 가드보다 앞) · isEmptyDailySummary → skip,
 *    heart-rate.ts 가 isEmptyHeartRate → skip, cleanup 스크립트가 where 빌더를 쓰고 --apply 없이는 삭제하지 않으며 --from/--to 를 받는다
 * 6. 사전 리뷰 major 3 회귀: get_weight_loss_status 연속 결손이 행 배열이 아니라 달력 날짜 기준 — 행이 없는 날은 끊김
 *
 * 실행: npm run verify:empty-day-skip
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DAILY_SUMMARY_CORE_FIELDS,
  DAILY_SUMMARY_OTHER_METRIC_COLUMNS,
  coreEmptyDailySummaryWhere,
  emptyDailySummaryWhere,
  emptyHeartRateWhere,
  isEmptyDailySummary,
  isEmptyHeartRate,
  isPrivacyProtected,
} from "../src/lib/garmin/empty-day";
import { countConsecutiveBelow } from "../src/mcp/tools/weight-loss";

let failed = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`, detail === undefined ? "" : JSON.stringify(detail));
    failed++;
  }
}

// 2019-08-01 실측 응답 (워치 사용 전): 86키 중 4개만 non-null.
const stubDay = {
  userProfileId: 1, displayName: "x", calendarDate: "2019-08-01", source: "GARMIN", privacyProtected: false,
  totalSteps: null, restingHeartRate: null, totalKilocalories: null, activeKilocalories: null,
  bodyBatteryHighestValue: null, bodyBatteryMostRecentValue: null, averageStressLevel: null,
  includesWellnessData: false, includesActivityData: false, wellnessStartTimeGmt: null,
};
// 2026-09-15 실측 (정상)
const realDay = {
  ...stubDay, calendarDate: "2026-09-15", totalSteps: 16077, restingHeartRate: 49, totalKilocalories: 2940,
  activeKilocalories: 807, bodyBatteryHighestValue: 93, includesWellnessData: true,
};

console.log("\n[1] isEmptyDailySummary");
check("핵심 지표 4개 정의 (걸음·안정시HR·총칼로리·바디배터리 최고)", DAILY_SUMMARY_CORE_FIELDS.join(",") === "totalSteps,restingHeartRate,totalKilocalories,bodyBatteryHighestValue");
check("2019-08-01 stub → 빈 날", isEmptyDailySummary(stubDay) === true);
check("정상 날 → 저장", isEmptyDailySummary(realDay) === false);
check("전부 0 도 빈 날 (Garmin 이 0 으로 채우는 경우)", isEmptyDailySummary({ ...stubDay, totalSteps: 0, restingHeartRate: 0, totalKilocalories: 0, bodyBatteryHighestValue: 0 }) === true);
check("걸음만 있어도 저장 (수면·HR 없이 착용)", isEmptyDailySummary({ ...stubDay, totalSteps: 120 }) === false);
check("총칼로리(BMR)만 있어도 저장", isEmptyDailySummary({ ...stubDay, totalKilocalories: 1800 }) === false);
check("핵심 밖 필드(스트레스)만 있으면 여전히 빈 날 — 핵심 4개 기준", isEmptyDailySummary({ ...stubDay, averageStressLevel: 20 }) === true);
check("문자열 숫자도 값으로 인정", isEmptyDailySummary({ ...stubDay, totalSteps: "300" }) === false);
check("키 자체가 없는 응답 → 빈 날", isEmptyDailySummary({ calendarDate: "2019-08-01" }) === true);

console.log("\n[2] isPrivacyProtected (A11)");
check("true → 이상", isPrivacyProtected({ ...stubDay, privacyProtected: true }) === true);
check("false → 정상", isPrivacyProtected(stubDay) === false);
check("키 없음 → 정상", isPrivacyProtected({ calendarDate: "2019-08-01" }) === false);
check("문자열 'true' 는 이상으로 보지 않음 (엄격 비교)", isPrivacyProtected({ privacyProtected: "true" }) === false);

console.log("\n[3] isEmptyHeartRate");
check("2019-08-01 실측 (restingHeartRate null · heartRateValues null) → 빈 날", isEmptyHeartRate({ calendarDate: "2019-08-01", restingHeartRate: null, maxHeartRate: null, minHeartRate: null, heartRateValues: null }) === true);
check("heartRateValues [] 도 빈 날", isEmptyHeartRate({ restingHeartRate: null, heartRateValues: [] }) === true);
check("restingHeartRate 만 있어도 저장", isEmptyHeartRate({ restingHeartRate: 49, heartRateValues: null }) === false);
check("heartRateValues 만 있어도 저장", isEmptyHeartRate({ restingHeartRate: null, heartRateValues: [[1700000000000, 60]] }) === false);
check("restingHeartRate 0 은 null 취급", isEmptyHeartRate({ restingHeartRate: 0, heartRateValues: [] }) === true);
check("키 없음 → 빈 날", isEmptyHeartRate({}) === true);

console.log("\n[4] cleanup where 빌더");
const core = coreEmptyDailySummaryWhere();
const coreCols = core.AND.map((c) => Object.keys((c as { OR: Record<string, unknown>[] }).OR[0])[0]);
check("핵심 4개: steps/restingHR/totalCalories/bodyBatteryHigh 각각 null 또는 0", coreCols.join(",") === "steps,restingHR,totalCalories,bodyBatteryHigh" && core.AND.every((c) => JSON.stringify((c as { OR: unknown[] }).OR[1]).includes(":0")), core);
const dw = emptyDailySummaryWhere();
const otherCols = dw.AND.slice(4).map((c) => Object.keys(c)[0]);
check("삭제 조건 = 핵심 4개 + 나머지 지표·밸런스 컬럼 전부 null (skip 조건보다 엄격)", dw.AND.length === 4 + DAILY_SUMMARY_OTHER_METRIC_COLUMNS.length && otherCols.join(",") === DAILY_SUMMARY_OTHER_METRIC_COLUMNS.join(",") && dw.AND.slice(4).every((c) => Object.values(c)[0] === null), otherCols);
for (const must of ["estimatedIntakeCalories", "calorieBalance", "avgStress", "avgSpo2", "activeCalories", "bodyBatteryCharged", "stressHighDuration"]) {
  check(`삭제 조건에 ${must} IS NULL 포함`, otherCols.includes(must));
}
check("HeartRateRecord: 저장 컬럼 전부 null (hrvBaseline 포함)", JSON.stringify(emptyHeartRateWhere()) === JSON.stringify({ restingHR: null, avgHR: null, maxHR: null, minHR: null, hrvStatus: null, hrvBaseline: null }));

console.log("\n[5] 소스 스캔");
const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const ds = read("src", "lib", "garmin", "fetchers", "daily-summary.ts");
check("daily-summary.ts: privacyProtected → throw", /if \(isPrivacyProtected\(summary\)\) \{[\s\S]{0,120}?throw privacyProtectedError\(/.test(ds));
check("daily-summary.ts: 빈 날 → continue (upsert 전)", /if \(isEmptyDailySummary\(summary\)\) \{[\s\S]*?continue;/.test(ds) && ds.indexOf("isEmptyDailySummary(summary)") < ds.indexOf("prisma.dailySummary.upsert"));
check("daily-summary.ts: privacy 검사가 미래 날짜 가드보다 앞 (stub 이든 아니든 인증 이상은 실패)", ds.indexOf("isPrivacyProtected(summary)") < ds.indexOf("todayKSTString()"));
check("daily-summary.ts: privacy 검사가 calendarDate 가드보다 앞 (major 1: 마스킹 응답은 calendarDate 도 없을 수 있다)", ds.indexOf("isPrivacyProtected(summary)") < ds.indexOf("summary.calendarDate"));
check("daily-summary.ts: privacy 오류 메시지가 인증 실패 알림 패턴(unauthorized)에 걸린다", /privacyProtected=true[^`]*unauthorized/.test(ds));
// Codex P2 (PR #387): plain Error 는 withReauth(401/403 만 재인증) 를 못 타 캐시 토큰이 계속 재사용된다 → status 403
check("daily-summary.ts: privacy 오류에 status 403 (withReauth 재인증 경로)", /function privacyProtectedError[\s\S]*?\{ status: 403 \}/.test(ds) && ds.includes("throw privacyProtectedError(dateStr)"));
// Codex P2 2회차: withReauth 는 메모리만 비우고 authenticate() 가 같은 토큰 파일을 재로드 → throw 전에 영속 토큰 폐기
check("daily-summary.ts: throw 전에 evictPersistedToken() (영속 토큰 재로드 방지)", /evictPersistedToken\(\);\s*throw privacyProtectedError\(dateStr\)/.test(ds));
const client = read("src", "lib", "garmin", "client.ts");
check("client.ts: evictPersistedToken 이 oauth1/oauth2 토큰 파일을 지우고 resetClient", /function evictPersistedToken[\s\S]*?oauth1_token\.json[\s\S]*?oauth2_token\.json[\s\S]*?unlinkSync[\s\S]*?resetClient\(\)/.test(client));
const hr = read("src", "lib", "garmin", "fetchers", "heart-rate.ts");
check("heart-rate.ts: 빈 날 → continue (HRV 조회·upsert 전)", /if \(isEmptyHeartRate\(raw\)\) \{[\s\S]*?continue;/.test(hr) && hr.indexOf("isEmptyHeartRate(raw)") < hr.indexOf("getSleepData"));
const cleanup = read("scripts", "cleanup-stub-days.ts");
check("cleanup: where 빌더 사용 (조건 인라인 금지)", cleanup.includes("emptyDailySummaryWhere()") && cleanup.includes("emptyHeartRateWhere()") && !/deleteMany\(\{\s*where:\s*\{/.test(cleanup));
check("cleanup: --apply 없이는 삭제하지 않는다", /if \(!apply\) \{[\s\S]*?return;/.test(cleanup) && cleanup.indexOf("if (!apply)") < cleanup.indexOf("deleteMany"));
check("cleanup: 두 테이블 삭제는 한 트랜잭션", /\$transaction\(\[\s*prisma\.dailySummary\.deleteMany[\s\S]*?prisma\.heartRateRecord\.deleteMany/.test(cleanup));
check("cleanup: --from/--to 범위 인자 + 핵심만 빈 행(삭제 제외) 경고", cleanup.includes('"--from"') && cleanup.includes('"--to"') && cleanup.includes("coreEmptyDailySummaryWhere()") && cleanup.includes("NOT: emptyDailySummaryWhere()"));
// Codex P2 3회차: take: 20 표본 길이를 총건수로 보고하면 20건 초과가 가려진다 → 별도 count
check("cleanup: 제외 행 총건수는 별도 count (표본 20건과 분리)", /prisma\.dailySummary\.count\(\{ where: partialWhere \}\)/.test(cleanup) && cleanup.includes("${partialCount}건은 삭제하지 않습니다"));

console.log("\n[6] 연속 결손 streak — 행 없는 날은 끊김 (major 3)");
const today = new Date("2026-09-18T00:00:00+09:00");
const d = (n: number) => new Date(today.getTime() - n * 86400000);
// 오늘·어제 결손, 그저께 행 없음(워치 미착용), 3~4일 전 결손
const balances = [
  { date: d(4), calorieBalance: -900 },
  { date: d(3), calorieBalance: -800 },
  { date: d(1), calorieBalance: -600 },
  { date: d(0), calorieBalance: -500 },
];
check("행 없는 날에서 끊김 → 2 (이전 행 배열 순회는 4)", countConsecutiveBelow(balances, today, 0, 7) === 2);
check("-750 미만 연속: 오늘 -500 에서 즉시 끊김 → 0", countConsecutiveBelow(balances, today, -750, 7) === 0);
check("null 행도 끊김", countConsecutiveBelow([{ date: d(1), calorieBalance: -600 }, { date: d(0), calorieBalance: null }], today, 0, 7) === 0);
check("연속이면 전부 셈 · maxDays 창 상한", countConsecutiveBelow([0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ date: d(n), calorieBalance: -100 })), today, 0, 7) === 7);
check("오늘 행 없음 → 0", countConsecutiveBelow([{ date: d(1), calorieBalance: -600 }], today, 0, 7) === 0);
const wl = read("src", "mcp", "tools", "weight-loss.ts");
check("weight-loss.ts 가 countConsecutiveBelow 를 쓴다 (행 배열 역순 루프 재유입 방지)", wl.includes("countConsecutiveBelow(balancesRaw, kstTodayMidnight, 0, 7)") && wl.includes("countConsecutiveBelow(balancesRaw, kstTodayMidnight, -750, 7)") && !/for \(let i = balancesRaw\.length - 1/.test(wl));

console.log(failed === 0 ? "\n✅ verify-empty-day-skip 통과" : `\n❌ ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
