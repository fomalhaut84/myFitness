// #342: extractSleepSpO2Series — epoch SpO2 시계열 파싱 회귀 테스트.
//
// 핵심 회귀 지점: epochTimestamp 는 타임존 접미사가 없는 GMT 문자열이라
// new Date(str) 로 파싱하면 서버 TZ 에 따라 결과가 달라진다 (KST 서버면 9시간 밀림).
//
// Run: npx tsx scripts/test-sleep-spo2-series.ts

import { extractSleepSpO2Series } from "@/lib/garmin/sleep-spo2-series";

let failures = 0;

function assert(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
    failures += 1;
  }
}

function epoch(ts: string, reading: number, confidence = 3) {
  return {
    deviceId: 3441128119,
    spo2Reading: reading,
    calendarDate: "2026-04-01T00:00:00.0",
    epochDuration: 60,
    userProfilePK: 86560194,
    epochTimestamp: ts,
    readingConfidence: confidence,
  };
}

console.log("== 실제 Garmin shape (2026-04-01 rawData 기준) ==");
{
  const out = extractSleepSpO2Series({
    wellnessEpochSPO2DataDTOList: [
      epoch("2026-04-01T14:34:00.0", 95, 5),
      epoch("2026-04-01T14:35:00.0", 95, 4),
      epoch("2026-04-01T14:36:00.0", 94, 3),
    ],
  });
  assert("포인트 3건", out.length === 3, JSON.stringify(out));
  assert("값 보존", out.map((p) => p.v).join(",") === "95,95,94", JSON.stringify(out));
}

console.log("\n== TZ 해석: 접미사 없는 GMT 문자열을 UTC 로 (서버 TZ 무관) ==");
{
  const out = extractSleepSpO2Series({
    wellnessEpochSPO2DataDTOList: [epoch("2026-04-01T14:34:00.0", 95)],
  });
  const expected = Date.UTC(2026, 3, 1, 14, 34, 0);
  assert(
    `t === Date.UTC(2026,3,1,14,34) (${expected})`,
    out[0]?.t === expected,
    `got ${out[0]?.t} (diff ${((out[0]?.t ?? 0) - expected) / 3600000}h)`,
  );
  // sleepMeasurementStartGMT 와 같은 instant 여야 한다.
  assert(
    "sleepStartTimestampGMT 와 동일 instant",
    out[0]?.t === Date.parse("2026-04-01T14:34:00.000Z"),
  );
}
{
  // 이미 오프셋이 붙어 있으면 중복으로 Z 를 붙이지 않는다.
  const out = extractSleepSpO2Series({
    wellnessEpochSPO2DataDTOList: [epoch("2026-04-01T14:34:00.000Z", 95)],
  });
  assert(
    "Z 접미사 있는 입력도 동일 결과",
    out[0]?.t === Date.UTC(2026, 3, 1, 14, 34, 0),
    String(out[0]?.t),
  );
}
{
  const out = extractSleepSpO2Series({
    wellnessEpochSPO2DataDTOList: [epoch("2026-04-01T23:34:00.0+09:00", 95)],
  });
  assert(
    "+09:00 오프셋 입력도 존중",
    out[0]?.t === Date.UTC(2026, 3, 1, 14, 34, 0),
    String(out[0]?.t),
  );
}

console.log("\n== 정렬: API 순서를 신뢰하지 않는다 ==");
{
  const out = extractSleepSpO2Series({
    wellnessEpochSPO2DataDTOList: [
      epoch("2026-04-01T16:00:00.0", 92),
      epoch("2026-04-01T14:34:00.0", 95),
      epoch("2026-04-01T15:00:00.0", 90),
    ],
  });
  assert(
    "시각 오름차순",
    out.map((p) => p.v).join(",") === "95,90,92",
    JSON.stringify(out.map((p) => p.v)),
  );
}

console.log("\n== 최저값이 Stat 카드와 일치해야 한다 ==");
{
  // readingConfidence 가 낮아도 버리지 않는다 — 버리면 최저 지점이 그래프에서 사라져
  // dailySleepDTO.lowestSpO2Value 와 어긋난다.
  const out = extractSleepSpO2Series({
    wellnessEpochSPO2DataDTOList: [
      epoch("2026-04-01T14:34:00.0", 95, 5),
      epoch("2026-04-01T15:00:00.0", 84, 1),
      epoch("2026-04-01T16:00:00.0", 93, 27),
    ],
  });
  assert("포인트 3건 모두 유지", out.length === 3, JSON.stringify(out));
  assert(
    "최저 84 (confidence 1 이어도 유지)",
    Math.min(...out.map((p) => p.v)) === 84,
  );
}

console.log("\n== 범위 밖 · 파싱 불가 element 는 건너뛰되 나머지는 살린다 ==");
{
  const out = extractSleepSpO2Series({
    wellnessEpochSPO2DataDTOList: [
      epoch("2026-04-01T14:34:00.0", 95),
      epoch("2026-04-01T14:35:00.0", 0),        // sentinel
      epoch("2026-04-01T14:36:00.0", 101),      // 범위 밖
      epoch("", 93),                             // 시각 없음
      { spo2Reading: 92 },                       // epochTimestamp 자체 없음
      epoch("2026-04-01T14:37:00.0", 94),
      null,
      "nope",
    ],
  });
  assert("유효 2건만 남음", out.length === 2, JSON.stringify(out));
  assert("값 95, 94", out.map((p) => p.v).join(",") === "95,94", JSON.stringify(out));
}

console.log("\n== 미측정 야간 · 이상 shape → 빈 배열 (크래시 없음) ==");
for (const bad of [
  null,
  undefined,
  42,
  "raw",
  [],
  {},
  { wellnessEpochSPO2DataDTOList: null },
  { wellnessEpochSPO2DataDTOList: [] },
  { wellnessEpochSPO2DataDTOList: "nope" },
  { wellnessEpochSPO2DataDTOList: {} },
]) {
  const out = extractSleepSpO2Series(bad);
  assert(
    `${JSON.stringify(bad) ?? "undefined"} → []`,
    Array.isArray(out) && out.length === 0,
    JSON.stringify(out),
  );
}

console.log(failures === 0 ? "\n✅ 전체 통과" : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
