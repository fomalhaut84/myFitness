// #440: 활동 평가 컨텍스트 조립 — 결측 섹션은 조용히 빠지고, 프롬프트에 "없음" 이 들어가지 않는다.
import { describe, expect, it } from "vitest";
import { buildEvalContext, EVAL_SECTION_TITLES } from "../build-context";
import type { EvalInput } from "../types";
import { toEvalLaps } from "../splits";

const lap = (paceSec: number, hr = 140) => ({ distance: 1000, duration: paceSec, averageSpeed: 1000 / paceSec, averageHR: hr, maxHR: 150, averageRunCadence: 172, elevationGain: 1 });

function fullInput(): EvalInput {
  return {
    activity: {
      id: "act1",
      name: "트랙 러닝",
      activityType: "track_running",
      startIso: "2026-04-05T12:51:00.000Z",
      ymd: "2026-04-05",
      durationSec: 3205,
      distanceM: 7320,
      calories: 480,
      avgHR: 123,
      maxHR: 147,
      avgPace: 315,
      elevationGainM: 3,
      avgCadence: 172,
      avgStrideLengthM: 1.1,
      avgVerticalOscillationCm: 8.2,
      avgGroundContactTimeMs: 262,
      aerobicTE: 2.8,
      anaerobicTE: 0.3,
      avgRespirationRate: 28,
      lapCount: 8,
      vo2maxEstimate: 49,
      zoneDistribution: { z1: 100, z2: 2200, z3: 700, z4: 0, z5: 0 },
      estimatedZone: 2,
      intensityScore: 34,
      intensityLabel: "easy",
      routeTag: "트랙",
      wristTempMaxC: 24,
      wristTempMinC: 21,
      weatherTempC: 11.2,
      weatherApparentTempC: 9.8,
      weatherHumidityPct: 48,
      weatherWindMs: 1.8,
      weatherPrecipMm: 0,
      weatherCode: 1,
      hrr2: 16,
      hrrDrop10: 48,
    },
    extras: {
      trainingLoad: 58,
      trainingEffectLabel: "MAINTAINING",
      aerobicTEMessage: null,
      avgPower: 251,
      normPower: 258,
      maxPower: null,
      vo2maxValue: 49,
      movingDurationSec: 3060,
      elapsedDurationSec: 3205,
      verticalRatioPct: 8.9,
      groundContactBalancePct: 49.6,
      fastestSplit1000Sec: 289,
      bodyBatteryDiff: -11,
    },
    recovery: {
      hasRecord: true,
      endIso: "2026-04-05T13:44:39.000Z",
      points: [
        { offsetMin: -4, bpm: 124 },
        { offsetMin: -2, bpm: 125 },
        { offsetMin: 0, bpm: 125 },
        { offsetMin: 2, bpm: 109 },
        { offsetMin: 4, bpm: 92 },
        { offsetMin: 6, bpm: null },
        { offsetMin: 10, bpm: 77 },
      ],
      hrr2: 16,
      drop10: 48,
      postSamples: 4,
    },
    laps: toEvalLaps([lap(300), lap(310), lap(320, 144), lap(330, 150)]),
    sameCourse: [
      { id: "s1", ymd: "2026-03-29", name: "트랙", distanceM: 7300, avgPace: 323, avgHR: 126, avgCadence: null, hrr2: null, intensityLabel: "easy", routeTag: "트랙" },
      { id: "s2", ymd: "2026-03-22", name: "트랙", distanceM: 7250, avgPace: 323, avgHR: 126, avgCadence: null, hrr2: null, intensityLabel: "easy", routeTag: "트랙" },
    ],
    similarDistance: [
      { id: "d1", ymd: "2026-03-15", name: "강변", distanceM: 7000, avgPace: 324, avgHR: 128, avgCadence: 170, hrr2: 14, intensityLabel: "easy", routeTag: null },
      { id: "d2", ymd: "2026-03-08", name: "강변", distanceM: 7500, avgPace: 330, avgHR: 130, avgCadence: 168, hrr2: 12, intensityLabel: "tempo", routeTag: null },
    ],
    hrrBaseline: { year: 2026, median: 14, n: 9 },
    bucketBest: null,
  };
}

describe("buildEvalContext — 전체 모드", () => {
  it("섹션 8개가 상세 페이지 순서로 들어가고 출력 지시가 그 제목만 나열한다", () => {
    const ctx = buildEvalContext(fullInput());
    expect(ctx.mode).toBe("full");
    expect(ctx.sections.map((s) => s.id)).toEqual(["basic", "splits", "intensity", "recovery", "dynamics", "extra", "environment", "comparison"]);
    expect(ctx.omitted).toEqual([]);
    for (const s of ctx.sections) expect(ctx.prompt).toContain(`## ${s.title}`);
    expect(ctx.prompt).toContain("### 종합");
    expect(ctx.prompt).toContain(ctx.sections.map((s) => s.title).join(" · "));
  });

  it("프롬프트에 없음 · null · undefined 가 들어가지 않는다", () => {
    const ctx = buildEvalContext(fullInput());
    expect(ctx.prompt).not.toMatch(/없음|null|undefined|NaN/);
  });

  it("기본 지표 — 정지 시간은 1분 이상일 때만, 페이스는 m'ss\" 표기", () => {
    const ctx = buildEvalContext(fullInput());
    const basic = ctx.sections.find((s) => s.id === "basic")!;
    expect(basic.lines.join("\n")).toContain("5'15\"/km");
    expect(basic.lines.join("\n")).toContain("정지 2분 25초");
    const short = fullInput();
    short.extras.movingDurationSec = 3180;
    expect(buildEvalContext(short).sections.find((s) => s.id === "basic")!.lines.join("\n")).not.toContain("정지");
  });

  it("일시 · 종료 시각은 KST HH:MM (ISO 문자열 파싱 — 실데이터 검증에서 \"-\" 로 나온 회귀)", () => {
    const ctx = buildEvalContext(fullInput());
    expect(ctx.sections.find((s) => s.id === "basic")!.lines[0]).toContain("2026-04-05 21:51 KST");
    expect(ctx.sections.find((s) => s.id === "recovery")!.lines[0]).toContain("종료 22:44 KST");
  });

  it("보폭 — m 값은 ×100, 파서 정정 이전의 cm 값 (≥ 10) 은 그대로 (로컬 실측 78.87 → 7887cm 회귀)", () => {
    const m = buildEvalContext(fullInput()).sections.find((s) => s.id === "dynamics")!.lines.join("\n");
    expect(m).toContain("보폭 110cm");
    const legacy = fullInput();
    legacy.activity = { ...legacy.activity, avgStrideLengthM: 78.87 };
    expect(buildEvalContext(legacy).sections.find((s) => s.id === "dynamics")!.lines.join("\n")).toContain("보폭 79cm");
  });

  it("기본 지표에 케이던스는 없다 (다이나믹스와 중복 — 사전 리뷰 info 6)", () => {
    const basic = buildEvalContext(fullInput()).sections.find((s) => s.id === "basic")!;
    expect(basic.lines.some((l) => l.includes("케이던스"))).toBe(false);
  });

  it("비교 델타는 반올림 뒤 부호 — -0 이 나오지 않는다 (사전 리뷰 info 5)", () => {
    const tiny = fullInput();
    tiny.sameCourse = [{ ...tiny.sameCourse[0], avgPace: 315.3, avgHR: 123 }];
    tiny.similarDistance = [];
    const text = buildEvalContext(tiny).sections.find((s) => s.id === "comparison")!.lines.join("\n");
    expect(text).toContain("페이스 +0초/km");
    // 날짜 (`2026-03-29`) 의 `-0` 은 제외하고 델타만 본다
    expect(text).not.toMatch(/페이스 -0초|심박 -0bpm/);
  });

  it("스플릿 — 파생값 줄과 km 표", () => {
    const splits = buildEvalContext(fullInput()).sections.find((s) => s.id === "splits")!;
    const text = splits.lines.join("\n");
    expect(text).toContain("전반 5'05\"/km → 후반 5'25\"/km (+20초, positive split)");
    expect(text).toContain("첫 km 5'00\" (평균보다 15초 빠름)");
    expect(text).toContain("심박 드리프트 +7bpm");
    expect(text).toContain("1km 5'00\"");
  });

  it("회복 — 결측 오프셋 줄은 빠지고 올해 중앙값 대비가 붙는다", () => {
    const rec = buildEvalContext(fullInput()).sections.find((s) => s.id === "recovery")!;
    const text = rec.lines.join("\n");
    expect(text).toContain("+2분 109bpm");
    expect(text).not.toContain("+6분");
    expect(text).toContain("2분 HRR 16bpm");
    expect(text).toContain("2026년 중앙값 14bpm (9건) 대비 +2");
    expect(text).toContain("2분 해상도");
  });

  it("회복 — 그 날 심박 없음 · 종료 후 샘플 부족이면 섹션 자체가 빠진다 (omitted 에도 없다)", () => {
    const noRecord = fullInput();
    noRecord.recovery = { hasRecord: false, endIso: "x", points: [], hrr2: null, drop10: null, postSamples: 0 };
    let ctx = buildEvalContext(noRecord);
    expect(ctx.sections.some((s) => s.id === "recovery")).toBe(false);
    expect(ctx.omitted).toEqual([]);
    const few = fullInput();
    few.recovery = { ...few.recovery!, postSamples: 1, hrr2: null };
    ctx = buildEvalContext(few);
    expect(ctx.sections.some((s) => s.id === "recovery")).toBe(false);
  });

  it("스플릿 조회 실패 (laps null) 는 omitted 에 남고 출력 지시에서 제목이 빠진다", () => {
    const failed = fullInput();
    failed.laps = null;
    const ctx = buildEvalContext(failed);
    expect(ctx.sections.some((s) => s.id === "splits")).toBe(false);
    expect(ctx.omitted).toEqual([{ id: "splits", title: EVAL_SECTION_TITLES.splits, reason: "Garmin 스플릿 조회 실패" }]);
    expect(ctx.prompt).not.toContain(EVAL_SECTION_TITLES.splits);
  });

  it("km 랩이 없으면 (laps []) 섹션도 omitted 도 없다", () => {
    const empty = fullInput();
    empty.laps = [];
    const ctx = buildEvalContext(empty);
    expect(ctx.sections.some((s) => s.id === "splits")).toBe(false);
    expect(ctx.omitted).toEqual([]);
  });

  it("환경 — 기상과 손목 온도는 다른 줄", () => {
    const env = buildEvalContext(fullInput()).sections.find((s) => s.id === "environment")!;
    expect(env.lines.some((l) => l.startsWith("기상") && l.includes("11.2°C") && l.includes("구름"))).toBe(true);
    expect(env.lines.some((l) => l.startsWith("손목 온도") && l.includes("21~24°C"))).toBe(true);
    expect(env.lines.find((l) => l.startsWith("기상"))).not.toContain("손목");
  });

  it("비교 — 같은 코스 델타 · 비슷한 거리 중앙값 · 개인 최고", () => {
    const withBest = fullInput();
    withBest.bucketBest = { bucket: "10k", activityId: "other", ymd: "2025-11-02", avgPace: 290 };
    const cmp = buildEvalContext(withBest).sections.find((s) => s.id === "comparison")!;
    const text = cmp.lines.join("\n");
    expect(text).toContain("같은 코스 최근 2회");
    expect(text).toContain("페이스 -8초/km");
    expect(text).toContain("심박 -3bpm");
    expect(text).toContain("비슷한 거리 (±10%) 최근 2건");
    expect(text).toContain("중앙값 5'27\"/km");
    expect(text).toContain("10k 개인 최고 4'50\"/km (2025-11-02)");
    // 이 활동이 곧 개인 최고면 그렇게 말한다
    withBest.bucketBest = { bucket: "10k", activityId: "act1", ymd: "2026-04-05", avgPace: 315 };
    expect(buildEvalContext(withBest).sections.find((s) => s.id === "comparison")!.lines.join("\n")).toContain("이 활동이 10k 개인 최고");
  });

  it("비교 대상이 하나도 없으면 섹션이 빠진다", () => {
    const none = fullInput();
    none.sameCourse = [];
    none.similarDistance = [];
    none.bucketBest = null;
    expect(buildEvalContext(none).sections.some((s) => s.id === "comparison")).toBe(false);
  });
});

describe("buildEvalContext — 요약 모드 (러닝 외)", () => {
  it("기본 지표만 · 3줄 지시 · 러닝 섹션 없음", () => {
    const cycling = fullInput();
    cycling.activity = { ...cycling.activity, activityType: "indoor_cycling", name: "실내 사이클" };
    const ctx = buildEvalContext(cycling);
    expect(ctx.mode).toBe("brief");
    expect(ctx.sections.map((s) => s.id)).toEqual(["basic"]);
    expect(ctx.omitted).toEqual([]);
    expect(ctx.prompt).toContain("3줄 이내");
    expect(ctx.prompt).not.toContain("### 종합");
    // 분/km 페이스는 러닝 외에 뜻이 없다 (사전 리뷰 info 6)
    expect(ctx.prompt).not.toContain("평균 페이스");
  });
});
