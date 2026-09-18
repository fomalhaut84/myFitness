/**
 * #383 회귀 검증 — 워치 미착용 날의 빈 Garmin 응답을 stub 으로 저장하지 않는다.
 *
 * 1. isEmptyDailySummary: 2019-08-01 실측 stub(핵심 지표 전부 null) → 빈 날, 걸음만 있어도 저장, 0 도 null 취급
 * 2. isPrivacyProtected: true 만 이상 (false/undefined 는 정상)
 * 3. isEmptyHeartRate: restingHeartRate null + heartRateValues null/[] → 빈 날, 값이 하나라도 있으면 저장
 * 4. cleanup where 빌더: fetcher 조건과 같은 컬럼, 식단 기록(estimatedIntakeCalories) 있는 행 보호
 * 5. 소스 스캔: daily-summary.ts 가 isPrivacyProtected → throw · isEmptyDailySummary → skip, heart-rate.ts 가 isEmptyHeartRate → skip,
 *    cleanup 스크립트가 where 빌더를 쓰고 --apply 없이는 삭제하지 않는다
 *
 * 실행: npm run verify:empty-day-skip
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DAILY_SUMMARY_CORE_FIELDS,
  emptyDailySummaryWhere,
  emptyHeartRateWhere,
  isEmptyDailySummary,
  isEmptyHeartRate,
  isPrivacyProtected,
} from "../src/lib/garmin/empty-day";

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
const dw = emptyDailySummaryWhere();
const dailyCols = dw.AND.slice(0, 4).map((c) => Object.keys((c as { OR: Record<string, unknown>[] }).OR[0])[0]);
check("DailySummary: steps/restingHR/totalCalories/bodyBatteryHigh 각각 null 또는 0", dailyCols.join(",") === "steps,restingHR,totalCalories,bodyBatteryHigh" && dw.AND.slice(0, 4).every((c) => JSON.stringify((c as { OR: unknown[] }).OR[1]).includes(":0")), dw);
check("DailySummary: 식단 기록 있는 행 보호 (estimatedIntakeCalories: null 조건)", JSON.stringify(dw.AND[4]) === JSON.stringify({ estimatedIntakeCalories: null }));
check("HeartRateRecord: 저장 컬럼 전부 null", JSON.stringify(emptyHeartRateWhere()) === JSON.stringify({ restingHR: null, avgHR: null, maxHR: null, minHR: null, hrvStatus: null }));

console.log("\n[5] 소스 스캔");
const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const ds = read("src", "lib", "garmin", "fetchers", "daily-summary.ts");
check("daily-summary.ts: privacyProtected → throw", /if \(isPrivacyProtected\(summary\)\) \{\s*throw new Error/.test(ds));
check("daily-summary.ts: 빈 날 → continue (upsert 전)", /if \(isEmptyDailySummary\(summary\)\) \{[\s\S]*?continue;/.test(ds) && ds.indexOf("isEmptyDailySummary(summary)") < ds.indexOf("prisma.dailySummary.upsert"));
check("daily-summary.ts: privacy 검사가 미래 날짜 가드보다 앞 (stub 이든 아니든 인증 이상은 실패)", ds.indexOf("isPrivacyProtected(summary)") < ds.indexOf("todayKSTString()"));
const hr = read("src", "lib", "garmin", "fetchers", "heart-rate.ts");
check("heart-rate.ts: 빈 날 → continue (HRV 조회·upsert 전)", /if \(isEmptyHeartRate\(raw\)\) \{[\s\S]*?continue;/.test(hr) && hr.indexOf("isEmptyHeartRate(raw)") < hr.indexOf("getSleepData"));
const cleanup = read("scripts", "cleanup-stub-days.ts");
check("cleanup: where 빌더 사용 (조건 인라인 금지)", cleanup.includes("emptyDailySummaryWhere()") && cleanup.includes("emptyHeartRateWhere()") && !/deleteMany\(\{\s*where:\s*\{/.test(cleanup));
check("cleanup: --apply 없이는 삭제하지 않는다", /if \(!apply\) \{[\s\S]*?return;/.test(cleanup) && cleanup.indexOf("if (!apply)") < cleanup.indexOf("deleteMany"));
check("cleanup: 두 테이블 삭제는 한 트랜잭션", /\$transaction\(\[\s*prisma\.dailySummary\.deleteMany[\s\S]*?prisma\.heartRateRecord\.deleteMany/.test(cleanup));

console.log(failed === 0 ? "\n✅ verify-empty-day-skip 통과" : `\n❌ ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
