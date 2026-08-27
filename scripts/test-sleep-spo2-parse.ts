// #338: extractSleepSpO2 — 수면 SpO2 파싱 회귀 테스트.
//
// 회귀: 기존 fetcher 가 `averageSpo2` (존재하지 않는 키) 를 읽어 전 기간 null 로 저장.
// 실제 Garmin 키는 `dailySleepDTO.averageSpO2Value`. 아래 "실제 Garmin shape" 케이스가
// 그 버그를 직접 노출한다.
//
// Run: npx tsx scripts/test-sleep-spo2-parse.ts

import { extractSleepSpO2 } from "@/lib/garmin/fetchers/sleep-spo2";

let failures = 0;

function assert(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
    failures += 1;
  }
}

console.log("== 실제 Garmin shape (2026-03-30 rawData 기준) ==");
{
  const out = extractSleepSpO2({
    dailySleepDTO: {
      calendarDate: "2026-03-30",
      averageSpO2Value: 94,
      lowestSpO2Value: 83,
      highestSpO2Value: 99,
      averageSpO2HRSleep: 57,
    },
    wellnessSpO2SleepSummaryDTO: {
      averageSPO2: 94,
      lowestSPO2: 83,
      averageSpO2HR: 57,
    },
  });
  assert("avg = 94", out.avg === 94, JSON.stringify(out));
  assert("lowest = 83", out.lowest === 83, JSON.stringify(out));
  assert("highest = 99", out.highest === 99, JSON.stringify(out));
}

console.log("\n== 구 오타 키만 있는 payload → 전부 null ==");
{
  // `averageSpo2` 가 다시 코드에 살아나면 이 테스트가 깨진다.
  const out = extractSleepSpO2({
    dailySleepDTO: { averageSpo2: 94, lowestSpo2: 83 },
    averageSpo2: 94,
  });
  assert("avg null", out.avg === null, JSON.stringify(out));
  assert("lowest null", out.lowest === null, JSON.stringify(out));
  assert("highest null", out.highest === null, JSON.stringify(out));
}

console.log("\n== dailySleepDTO 결측 → wellnessSpO2SleepSummaryDTO 폴백 ==");
{
  const out = extractSleepSpO2({
    dailySleepDTO: { calendarDate: "2026-04-01" },
    wellnessSpO2SleepSummaryDTO: { averageSPO2: 93, lowestSPO2: 84 },
  });
  assert("avg = 93 (폴백)", out.avg === 93, JSON.stringify(out));
  assert("lowest = 84 (폴백)", out.lowest === 84, JSON.stringify(out));
  assert("highest null (summary DTO 에 대응 필드 없음)", out.highest === null);
}

console.log("\n== 필드별 독립 폴백 ==");
{
  // avg 만 있는 야간에도 avg 는 살아야 한다.
  const out = extractSleepSpO2({
    dailySleepDTO: { averageSpO2Value: 95 },
  });
  assert("avg = 95", out.avg === 95, JSON.stringify(out));
  assert("lowest null", out.lowest === null);
  assert("highest null", out.highest === null);
}
{
  // dto 는 lowest 만, summary 는 avg 만 — 각각 다른 소스에서 채워진다.
  const out = extractSleepSpO2({
    dailySleepDTO: { lowestSpO2Value: 88 },
    wellnessSpO2SleepSummaryDTO: { averageSPO2: 96 },
  });
  assert("avg = 96 (summary)", out.avg === 96, JSON.stringify(out));
  assert("lowest = 88 (dto 우선)", out.lowest === 88, JSON.stringify(out));
}
{
  // dto 값이 있으면 summary 보다 우선.
  const out = extractSleepSpO2({
    dailySleepDTO: { averageSpO2Value: 92 },
    wellnessSpO2SleepSummaryDTO: { averageSPO2: 99 },
  });
  assert("dto 우선 (92)", out.avg === 92, JSON.stringify(out));
}

console.log("\n== 미측정 야간 (2026-04-05 실사례) → 전부 null ==");
{
  const out = extractSleepSpO2({
    dailySleepDTO: { calendarDate: "2026-04-05", sleepTimeSeconds: 19560 },
    wellnessSpO2SleepSummaryDTO: null,
    wellnessEpochSPO2DataDTOList: [],
  });
  assert("avg null", out.avg === null, JSON.stringify(out));
  assert("lowest null", out.lowest === null);
  assert("highest null", out.highest === null);
}

console.log("\n== 범위 밖 · 비정상 값 → null ==");
for (const bad of [0, -1, 101, 150, NaN, Infinity, "", "  ", "abc", true, {}, []]) {
  const out = extractSleepSpO2({ dailySleepDTO: { averageSpO2Value: bad } });
  assert(`${JSON.stringify(bad)} → null`, out.avg === null, JSON.stringify(out));
}
{
  // 경계값은 살린다.
  assert(
    "100 → 100 (경계 포함)",
    extractSleepSpO2({ dailySleepDTO: { averageSpO2Value: 100 } }).avg === 100,
  );
  assert(
    "숫자 문자열 \"94\" → 94",
    extractSleepSpO2({ dailySleepDTO: { averageSpO2Value: "94" } }).avg === 94,
  );
}

console.log("\n== 잘못된 최상위 shape → 크래시 없이 전부 null ==");
for (const bad of [null, undefined, 42, "sleep", [], { dailySleepDTO: "nope" }]) {
  const out = extractSleepSpO2(bad);
  assert(
    `${JSON.stringify(bad) ?? "undefined"} → 전부 null`,
    out.avg === null && out.lowest === null && out.highest === null,
    JSON.stringify(out),
  );
}

console.log(
  failures === 0 ? "\n✅ 전체 통과" : `\n❌ 실패 ${failures}건`,
);
process.exit(failures === 0 ? 0 : 1);
