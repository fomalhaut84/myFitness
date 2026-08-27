// #342: extractSleepSpO2Series — epoch SpO2 시계열 파싱 회귀 테스트.
//
// 핵심 회귀 지점: epochTimestamp 는 타임존 접미사가 없는 GMT 문자열이라
// new Date(str) 로 파싱하면 서버 TZ 에 따라 결과가 달라진다 (KST 서버면 9시간 밀림).
//
// Run: npx tsx scripts/test-sleep-spo2-series.ts

import {
  buildSpO2ChartSeries,
  extractSleepSpO2Series,
  SPO2_GAP_BREAK_MS,
  spo2ChartYAxis,
} from "@/lib/garmin/sleep-spo2-series";

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

console.log("\n== 차트 시리즈: 센서 공백을 null 로 끊는다 (Codex P2) ==");
{
  const MIN = 60 * 1000;
  const base = Date.UTC(2026, 3, 1, 14, 0, 0);
  const series = [
    { t: base, v: 95 },
    { t: base + 1 * MIN, v: 94 },
    // 60분 dropout — 끊겨야 한다
    { t: base + 61 * MIN, v: 93 },
    { t: base + 62 * MIN, v: 92 },
  ];
  const out = buildSpO2ChartSeries(series);
  assert("포인트 4 + 단절점 1 = 5", out.length === 5, JSON.stringify(out));
  assert("단절점 v === null", out[2].v === null, JSON.stringify(out[2]));
  assert(
    "단절점은 공백 직전 포인트 바로 뒤",
    out[2].t === base + 1 * MIN + 1,
    String(out[2].t),
  );
  assert(
    "실제 값은 모두 보존",
    out.filter((p) => p.v !== null).map((p) => p.v).join(",") === "95,94,93,92",
    JSON.stringify(out.map((p) => p.v)),
  );
  assert(
    "t 는 단조 증가 (수치 시간축 전제)",
    out.every((p, i) => i === 0 || p.t > out[i - 1].t),
    JSON.stringify(out.map((p) => p.t)),
  );
}
{
  // 연속 구간은 끊지 않는다.
  const MIN = 60 * 1000;
  const base = Date.UTC(2026, 3, 1, 14, 0, 0);
  const out = buildSpO2ChartSeries([
    { t: base, v: 95 },
    { t: base + 1 * MIN, v: 94 },
    { t: base + 2 * MIN, v: 93 },
  ]);
  assert("단절점 없음", out.length === 3 && out.every((p) => p.v !== null));
}
{
  // 임계 경계: 정확히 GAP_BREAK_MS 는 끊지 않고, 초과부터 끊는다.
  const base = Date.UTC(2026, 3, 1, 14, 0, 0);
  const exact = buildSpO2ChartSeries([
    { t: base, v: 95 },
    { t: base + SPO2_GAP_BREAK_MS, v: 94 },
  ]);
  assert("gap === 임계 → 끊지 않음", exact.length === 2, JSON.stringify(exact));
  const over = buildSpO2ChartSeries([
    { t: base, v: 95 },
    { t: base + SPO2_GAP_BREAK_MS + 1, v: 94 },
  ]);
  assert("gap > 임계 → 끊음", over.length === 3 && over[1].v === null);
}
{
  assert("빈 입력 → 빈 배열", buildSpO2ChartSeries([]).length === 0);
  assert("포인트 1개 → 그대로", buildSpO2ChartSeries([{ t: 1, v: 95 }]).length === 1);
}

console.log("\n== Y축 하한 · 눈금 (Codex P2) ==");
{
  // 평상시: 실변동(83~100)이 하단에 눌리지 않게 80 기준.
  const a = spo2ChartYAxis(83);
  assert("min 83 → yMin 80", a.yMin === 80, String(a.yMin));
  assert(
    "눈금 80/85/90/95/100",
    a.ticks.join(",") === "80,85,90,95,100",
    a.ticks.join(","),
  );
}
{
  // 낮은 관측이 있으면 하한을 막지 않고 담는다 — 막아도 Recharts 가 되늘리고,
  // 잘라내면 Stat 카드 최저값과 어긋난다.
  const a = spo2ChartYAxis(20);
  assert("min 20 → yMin 18 (하한 고정 없음)", a.yMin === 18, String(a.yMin));
  // Codex P2 의 핵심: 확장된 구간이 라벨 없이 남으면 안 된다.
  // (구 코드는 domain 이 [20,100] 으로 늘어나도 눈금은 [70,90,95,100] 이라 20~70 이 무라벨)
  assert(
    "눈금이 하한 근처에서 시작해 100 까지 덮음",
    a.ticks[0] - a.yMin < 10 && a.ticks[a.ticks.length - 1] === 100,
    `yMin ${a.yMin} / ticks ${a.ticks.join(",")}`,
  );
  assert(
    "눈금이 4개 이상 (확장 구간에도 눈금 존재)",
    a.ticks.length >= 4 && a.ticks.filter((v) => v < 80).length >= 2,
    a.ticks.join(","),
  );
  assert(
    "눈금 간격이 균등",
    a.ticks.slice(2).every((v, i) => v - a.ticks[i + 1] === a.ticks[2] - a.ticks[1]),
    a.ticks.join(","),
  );
}
{
  const a = spo2ChartYAxis(72);
  assert("min 72 → yMin 70", a.yMin === 70, String(a.yMin));
  assert("100 포함", a.ticks[a.ticks.length - 1] === 100, a.ticks.join(","));
  assert("yMin 포함 또는 첫 눈금과 근접", a.ticks[0] <= 75, a.ticks.join(","));
}
{
  // 하한 라벨이 첫 눈금과 겹치지 않아야 한다.
  for (const m of [78, 79, 80, 81, 84, 90, 95, 100]) {
    const a = spo2ChartYAxis(m);
    const dup = new Set(a.ticks).size !== a.ticks.length;
    const sorted = a.ticks.every((v, i) => i === 0 || v > a.ticks[i - 1]);
    assert(
      `min ${m}: 눈금 중복/역전 없음 (${a.ticks.join(",")})`,
      !dup && sorted,
    );
    assert(`min ${m}: yMin(${a.yMin}) <= 첫 눈금`, a.yMin <= a.ticks[0]);
    assert(`min ${m}: 최저값이 domain 안`, a.yMin <= m);
  }
}

console.log(failures === 0 ? "\n✅ 전체 통과" : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
