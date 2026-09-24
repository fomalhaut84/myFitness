// #440: 섹션별 근거 줄 — 순수. 값이 null 인 항목은 줄 자체를 내지 않는다 (프롬프트에 "없음" 을 쓰지 않는다 — 모델이 결측을 언급하지 않게).
// 각 함수는 `string[]` 을 돌려주고, 빈 배열이면 빌더가 섹션을 뺀다.
import { isRunningType } from "@/lib/activity/running-types";
import { formatClock, formatDurationShort, formatEpochKST, formatPace } from "@/lib/format";
import { median } from "@/lib/insights/stats";
import { wmoLabel } from "@/lib/weather/wmo-label";
import { lapTableLines, summarizeLaps, type EvalLap } from "./splits";
import type { ComparisonRun, EvalInput } from "./types";

/** 정지 시간이 이보다 짧으면 언급하지 않는다 (신호 대기 수준) */
const MIN_STOP_SEC = 60;
/** 비교 표에 싣는 같은 코스 최근 건수 */
const SAME_COURSE_ROWS = 3;
const SIMILAR_WINDOW_DAYS = 365;

const INTENSITY_LABEL_KO: Record<string, string> = {
  recovery: "회복 런",
  easy: "이지 런",
  tempo: "템포 런",
  threshold: "한계치 런",
  interval: "인터벌",
  max: "최대 강도",
};

const pace = (secPerKm: number) => `${formatPace(secPerKm)}/km`;
/** 반올림 뒤 부호 — `-0.3` 이 `-0` 으로 찍히지 않게 (사전 리뷰 info 5) */
const signed = (n: number) => {
  const r = Math.round(n);
  return `${r < 0 ? "-" : "+"}${Math.abs(r)}`;
};
const km = (m: number) => `${(m / 1000).toFixed(2)}km`;
/** UTC ISO → KST HH:MM. `formatEpochKST` 는 숫자 문자열만 받아 ISO 는 먼저 파싱한다 (실데이터 검증에서 "-" 로 나왔다) */
const kstTime = (iso: string) => formatEpochKST(Date.parse(iso));
/**
 * 보폭 (cm). 스키마는 m (#278 파서가 Garmin cm ÷ 100) 이지만 파서 정정 이전 행은 cm 그대로 남아 있을 수 있다 (로컬 실측 78.87) —
 * 10 이상이면 이미 cm 로 본다 (사람 보폭이 10m 를 넘지 않는다).
 */
const STRIDE_CM_THRESHOLD = 10;
const strideCm = (v: number) => Math.round(v >= STRIDE_CM_THRESHOLD ? v : v * 100);
/** 값이 있을 때만 줄 */
const maybe = (value: number | string | null, render: (v: never) => string): string[] => (value === null ? [] : [render(value as never)]);

export function basicLines(input: EvalInput): string[] {
  const a = input.activity;
  const stopSec = input.extras.movingDurationSec !== null ? Math.round(a.durationSec - input.extras.movingDurationSec) : null;
  return [
    `이름 ${a.name} · 종목 ${a.activityType} · 일시 ${a.ymd} ${kstTime(a.startIso)} KST`,
    ...(a.distanceM !== null && a.distanceM > 0 ? [`거리 ${km(a.distanceM)}`] : []),
    `시간 ${formatClock(a.durationSec)}`,
    ...(stopSec !== null && stopSec >= MIN_STOP_SEC ? [`정지 ${formatDurationShort(stopSec)} (이동 ${formatClock(a.durationSec - stopSec)})`] : []),
    // 페이스 (분/km) 는 러닝에서만 뜻이 있다 — 요약 모드 (사이클 등) 의 이전 프롬프트에도 없었다 (사전 리뷰 info 6)
    ...(a.avgPace !== null && isRunningType(a.activityType) ? [`평균 페이스 ${pace(a.avgPace)}`] : []),
    ...(a.elevationGainM !== null && a.elevationGainM > 0 ? [`고도 상승 ${Math.round(a.elevationGainM)}m`] : []),
    ...maybe(a.calories, (c: number) => `칼로리 ${c}kcal`),
    ...(a.avgHR !== null ? [`평균 심박 ${a.avgHR}bpm${a.maxHR !== null ? ` · 최대 ${a.maxHR}bpm` : ""}`] : []),
  ];
}

function firstKmText(delta: number): string {
  if (delta === 0) return "평균과 같음";
  return delta < 0 ? `평균보다 ${Math.abs(delta)}초 빠름` : `평균보다 ${delta}초 느림`;
}

function splitKind(delta: number): string {
  if (delta === 0) return "even split";
  return delta > 0 ? "positive split" : "negative split";
}

export function splitLines(laps: readonly EvalLap[]): string[] {
  const s = summarizeLaps(laps);
  if (s === null) return [];
  const derived = [
    `km 랩 ${s.count}개 · 평균 ${pace(s.meanPaceSecPerKm)} · 가장 빠른 ${s.fastest.index}km ${formatPace(s.fastest.paceSecPerKm)} · 가장 느린 ${s.slowest.index}km ${formatPace(s.slowest.paceSecPerKm)}`,
    ...(s.firstKmDeltaSec !== null && s.firstKmPaceSecPerKm !== null ? [`첫 km ${formatPace(s.firstKmPaceSecPerKm)} (${firstKmText(s.firstKmDeltaSec)})`] : []),
    ...(s.halfSplitSec !== null && s.firstHalfPaceSecPerKm !== null && s.secondHalfPaceSecPerKm !== null
      ? [`전반 ${pace(s.firstHalfPaceSecPerKm)} → 후반 ${pace(s.secondHalfPaceSecPerKm)} (${signed(s.halfSplitSec)}초, ${splitKind(s.halfSplitSec)})`]
      : []),
    ...(s.paceCv !== null ? [`페이스 변동계수 ${(s.paceCv * 100).toFixed(1)}%`] : []),
    ...(s.hrDriftBpm !== null ? [`심박 드리프트 ${signed(s.hrDriftBpm)}bpm (후반 − 전반 평균)`] : []),
  ];
  return [...derived, "km 별 (페이스 · 평균 심박 · 케이던스 · 고도):", ...lapTableLines(laps)];
}

const ZONE_NAMES = ["회복", "이지", "에어로빅", "역치", "VO2max"];

export function intensityLines(input: EvalInput): string[] {
  const a = input.activity;
  const z = a.zoneDistribution;
  const values = z ? [z.z1, z.z2, z.z3, z.z4, z.z5] : [];
  const total = values.reduce((s, v) => s + v, 0);
  const zoneLine =
    total > 0
      ? [`존 분포 ${values.map((sec, i) => `Z${i + 1} ${ZONE_NAMES[i]} ${formatClock(sec)} (${Math.round((sec / total) * 100)}%)`).join(" · ")}`]
      : [];
  const label = a.intensityLabel !== null ? [`강도 라벨 ${INTENSITY_LABEL_KO[a.intensityLabel] ?? a.intensityLabel} (${a.intensityLabel})`] : [];
  const score = [
    ...(a.intensityScore !== null ? [`강도 점수 ${Math.round(a.intensityScore)} / 100`] : []),
    ...(a.estimatedZone !== null ? [`추정 대표 존 Z${a.estimatedZone}`] : []),
  ];
  return [...zoneLine, ...label, ...score];
}

/** 종료 후 유효 점이 이보다 적으면 곡선을 말할 수 없다 (#418 F9) */
const MIN_POST_SAMPLES = 2;

export function recoveryLines(input: EvalInput): string[] {
  const r = input.recovery;
  if (r === null || !r.hasRecord || r.postSamples < MIN_POST_SAMPLES) return [];
  const points = r.points.flatMap((p) => (p.bpm === null ? [] : [`${p.offsetMin > 0 ? "+" : ""}${p.offsetMin}분 ${p.bpm}bpm`]));
  const at0 = r.points.find((p) => p.offsetMin === 0)?.bpm ?? null;
  const at2 = r.points.find((p) => p.offsetMin === 2)?.bpm ?? null;
  const b = input.hrrBaseline;
  const baseline = r.hrr2 !== null && b !== null ? ` — ${b.year}년 중앙값 ${b.median}bpm (${b.n}건) 대비 ${signed(r.hrr2 - b.median)}` : "";
  return [
    `종료 ${kstTime(r.endIso)} KST 기준 심박: ${points.join(" · ")}`,
    ...(r.hrr2 !== null ? [`2분 HRR ${r.hrr2}bpm${at0 !== null && at2 !== null ? ` (${at0} → ${at2})` : ""}${baseline}${r.hrr2 < 0 ? " — 음수 = 종료 뒤 심박 상승 (쿨다운 없이 정지했거나 종료 시각이 어긋남)" : ""}`] : []),
    ...(r.drop10 !== null ? [`10분 낙차 ${r.drop10}bpm`] : []),
    "2분 해상도 (하루 심박 시계열 · 워치의 1분 HRR 과 다름)",
  ];
}

export function dynamicsLines(input: EvalInput): string[] {
  const a = input.activity;
  const x = input.extras;
  return [
    ...maybe(a.avgCadence, (v: number) => `케이던스 ${v}spm`),
    ...maybe(a.avgStrideLengthM, (v: number) => `보폭 ${strideCm(v)}cm`),
    ...maybe(a.avgVerticalOscillationCm, (v: number) => `수직 진동 ${v.toFixed(1)}cm`),
    ...maybe(a.avgGroundContactTimeMs, (v: number) => `지면접촉시간 ${Math.round(v)}ms`),
    ...maybe(x.verticalRatioPct, (v: number) => `수직 비율 ${v.toFixed(1)}%`),
    ...maybe(x.groundContactBalancePct, (v: number) => `좌우 균형 왼발 ${v.toFixed(1)}%`),
  ];
}

export function extraLines(input: EvalInput): string[] {
  const a = input.activity;
  const x = input.extras;
  const te = [
    ...(a.aerobicTE !== null ? [`유산소 TE ${a.aerobicTE.toFixed(1)}${x.trainingEffectLabel !== null ? ` (Garmin 라벨 ${x.trainingEffectLabel})` : ""}`] : []),
    ...maybe(a.anaerobicTE, (v: number) => `무산소 TE ${v.toFixed(1)}`),
  ];
  const power = [x.avgPower !== null ? `평균 ${x.avgPower}W` : null, x.normPower !== null ? `정규화 ${x.normPower}W` : null, x.maxPower !== null ? `최대 ${x.maxPower}W` : null].filter((s): s is string => s !== null);
  const vo2 = a.vo2maxEstimate ?? x.vo2maxValue;
  return [
    ...te,
    ...maybe(x.trainingLoad, (v: number) => `트레이닝 로드 ${Math.round(v)}`),
    ...(power.length > 0 ? [`파워 ${power.join(" · ")}`] : []),
    ...(vo2 !== null ? [`VO2max 추정 ${vo2.toFixed(1)}`] : []),
    ...maybe(a.avgRespirationRate, (v: number) => `평균 호흡수 ${Math.round(v)}회/분`),
    ...maybe(x.bodyBatteryDiff, (v: number) => `바디배터리 변화 ${signed(v)}`),
    ...maybe(a.lapCount, (v: number) => `랩 ${v}개`),
    ...maybe(x.fastestSplit1000Sec, (v: number) => `최고 1km ${formatPace(v)}`),
  ];
}

export function environmentLines(input: EvalInput): string[] {
  const a = input.activity;
  const weather = [
    a.weatherTempC !== null ? `${a.weatherTempC.toFixed(1)}°C${a.weatherApparentTempC !== null ? ` (체감 ${a.weatherApparentTempC.toFixed(1)}°C)` : ""}` : null,
    a.weatherHumidityPct !== null ? `습도 ${a.weatherHumidityPct}%` : null,
    a.weatherWindMs !== null ? `바람 ${a.weatherWindMs.toFixed(1)}m/s` : null,
    a.weatherPrecipMm !== null && a.weatherPrecipMm > 0 ? `강수 ${a.weatherPrecipMm.toFixed(1)}mm` : null,
    wmoLabel(a.weatherCode),
  ].filter((s): s is string => s !== null);
  const wrist =
    a.wristTempMinC !== null && a.wristTempMaxC !== null
      ? `${Math.round(a.wristTempMinC)}~${Math.round(a.wristTempMaxC)}°C`
      : a.wristTempMaxC !== null || a.wristTempMinC !== null
        ? `${Math.round((a.wristTempMaxC ?? a.wristTempMinC) as number)}°C`
        : null;
  return [
    ...(weather.length > 0 ? [`기상 (Open-Meteo, 활동 시작 시점) ${weather.join(" · ")}`] : []),
    ...(wrist !== null ? [`손목 온도 ${wrist} (햇빛 · 의류 영향 — 기상과 별개)`] : []),
  ];
}

function medianOf(runs: readonly ComparisonRun[], pick: (r: ComparisonRun) => number | null): number | null {
  return median(runs.flatMap((r) => (pick(r) === null ? [] : [pick(r) as number])));
}

function meanOf(runs: readonly ComparisonRun[], pick: (r: ComparisonRun) => number | null): number | null {
  const values = runs.flatMap((r) => (pick(r) === null ? [] : [pick(r) as number]));
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function deltaText(current: { avgPace: number | null; avgHR: number | null }, ref: { pace: number | null; hr: number | null }): string {
  const parts = [
    current.avgPace !== null && ref.pace !== null ? `페이스 ${signed(current.avgPace - ref.pace)}초/km` : null,
    current.avgHR !== null && ref.hr !== null ? `심박 ${signed(current.avgHR - ref.hr)}bpm` : null,
  ].filter((s): s is string => s !== null);
  return parts.length > 0 ? ` → 이번 ${parts.join(" · ")}` : "";
}

function runRow(r: ComparisonRun): string {
  const cells = [
    r.ymd,
    r.name,
    r.distanceM !== null ? km(r.distanceM) : null,
    r.avgPace !== null ? pace(r.avgPace) : null,
    r.avgHR !== null ? `${r.avgHR}bpm` : null,
    r.intensityLabel,
    r.routeTag !== null ? `#${r.routeTag}` : null,
  ].filter((s): s is string => s !== null);
  return `  ${cells.join(" · ")}`;
}

export function comparisonLines(input: EvalInput): string[] {
  const a = input.activity;
  const same = input.sameCourse;
  const similar = input.similarDistance;
  const best = input.bucketBest;
  const sameLines =
    same.length > 0
      ? (() => {
          const refPace = meanOf(same, (r) => r.avgPace);
          const refHr = meanOf(same, (r) => r.avgHR);
          const ref = [refPace !== null ? pace(refPace) : null, refHr !== null ? `${Math.round(refHr)}bpm` : null].filter((s): s is string => s !== null);
          return [
            `같은 코스 최근 ${same.length}회 (같은 시작점 ±10% 거리 또는 태그${a.routeTag !== null ? ` #${a.routeTag}` : ""}) 평균 ${ref.join(" · ")}${deltaText(a, { pace: refPace, hr: refHr !== null ? Math.round(refHr) : null })}`,
            ...same.slice(0, SAME_COURSE_ROWS).map(runRow),
          ];
        })()
      : [];
  const similarLines =
    similar.length > 0
      ? (() => {
          const mPace = medianOf(similar, (r) => r.avgPace);
          const mHr = medianOf(similar, (r) => r.avgHR);
          const mCad = medianOf(similar, (r) => r.avgCadence);
          const mHrr = medianOf(similar, (r) => r.hrr2);
          const ref = [
            mPace !== null ? pace(mPace) : null,
            mHr !== null ? `${Math.round(mHr)}bpm` : null,
            mCad !== null ? `케이던스 ${Math.round(mCad)}spm` : null,
            mHrr !== null ? `2분 HRR ${Math.round(mHrr)}bpm` : null,
          ].filter((s): s is string => s !== null);
          return [`비슷한 거리 (±10%) 최근 ${similar.length}건 (${SIMILAR_WINDOW_DAYS}일) 중앙값 ${ref.join(" · ")}${deltaText(a, { pace: mPace, hr: mHr !== null ? Math.round(mHr) : null })}`];
        })()
      : [];
  const bestLines =
    best === null
      ? []
      : best.activityId === a.id
        ? [`이 활동이 ${best.bucket} 개인 최고 (전 기간 최저 페이스)`]
        : [`${best.bucket} 개인 최고 ${pace(best.avgPace)} (${best.ymd})${a.avgPace !== null ? ` 대비 ${signed(a.avgPace - best.avgPace)}초/km` : ""}`];
  return [...sameLines, ...similarLines, ...bestLines];
}
