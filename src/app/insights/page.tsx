// #397 (M15-5): `/insights` 분석 — 두 값의 관계. 러닝 조회 1회 + 주 summary 1회 (캐시), 가공은 `lib/insights` 순수 함수.
// 패널 = 질문 → 차트 → 답 (큰 숫자 하나 + 근거 표). 기간은 전체 고정, 컨트롤은 패널별 계열 토글뿐.
import InsightPanel, { Answer, BigNumber } from "@/components/insights/InsightPanel";
import InsightScatter, { type ScatterSeries } from "@/components/insights/InsightScatter";
import ValueTable from "@/components/insights/ValueTable";
import ZoneStack from "@/components/insights/ZoneStack";
import { ZONE_COLORS, ZONE_NAMES } from "@/components/insights/zone-colors";
import ReadoutRow from "@/components/trends/ReadoutRow";
import { yearColor } from "@/components/trends/year-colors";
import { formatPace } from "@/lib/format";
import { todayKSTString } from "@/lib/garmin/utils";
import { getCachedHistorySummary, getCachedInsightRuns, getCachedLowerBound } from "@/lib/history/cache";
import {
  EFFICIENCY_BAND,
  HUMIDITY_LABELS,
  correlationWord,
  efficiencyByYear,
  efficiencyDelta,
  efficiencyPoints,
  heatPenalty,
  kmBandTable,
  lagCorrelations,
  lagPairs,
  paceByTempBin,
  usableRuns,
  weatherPoints,
  zoneShareByMonth,
  zoneShareCompare,
  type HumidityLevel,
  type InsightContext,
} from "@/lib/insights";

export const dynamic = "force-dynamic";

const HR_COLOR = "#f87171";
/** 습도 3단 — 걸음 색 `#fbbf24` 단일 색조 램프 (어두움 = 건조) */
const HUMIDITY_COLORS: Record<HumidityLevel, string> = { 0: "#7a5a12", 1: "#c9961d", 2: "#fbbf24" };
const LAGS = [0, 1, 2] as const;

const km1 = (m: number) => `${(m / 1000).toFixed(1)}km`;
const pct = (v: number | null) => (v === null ? null : `${Math.round(v * 100)}%`);
const signed = (v: number, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
const activityHref = (id: string) => `/activities/${id}`;

function yearSeries<T extends { year: number }>(
  items: readonly T[],
  years: readonly number[],
  currentYear: number,
  toPoint: (item: T) => { x: number; y: number; lines: string[]; href: string | null },
  race?: (item: T) => boolean,
): ScatterSeries[] {
  const byYear = years.map((year) => ({
    id: String(year),
    label: String(year),
    color: yearColor(year, years, currentYear, HR_COLOR),
    points: items.filter((it) => it.year === year && !(race && race(it))).map(toPoint),
  }));
  if (!race) return byYear;
  const races = items.filter(race);
  return races.length === 0 ? byYear : [...byYear, { id: "race", label: "레이스", color: "#e5e5e5", hollow: true, points: races.map(toPoint) }];
}

export default async function InsightsPage() {
  const ctx: InsightContext = { today: todayKSTString(), lowerBound: await getCachedLowerBound() };
  const currentYear = Number(ctx.today.slice(0, 4));
  const [allRuns, weeks] = await Promise.all([
    getCachedInsightRuns(ctx),
    getCachedHistorySummary(
      { granularity: "week", from: ctx.lowerBound, to: ctx.today, metrics: ["runningKm", "restingHR"], clampedFrom: false, clampedTo: false },
      ctx,
    ),
  ]);
  const { kept: runs, dropped, total } = usableRuns(allRuns);
  const years = [...new Set(runs.map((r) => r.year))].sort((a, b) => a - b);
  const filterNote = `러닝 ${total.toLocaleString("ko-KR")}건 중 ${runs.length.toLocaleString("ko-KR")}건 (3km 미만 · 페이스 범위 밖 ${dropped}건 제외)`;

  // A
  const effPoints = efficiencyPoints(runs);
  const effYears = efficiencyByYear(effPoints, EFFICIENCY_BAND, years);
  const effDelta = efficiencyDelta(effYears);
  const band = `${formatPace(EFFICIENCY_BAND[0])}~${formatPace(EFFICIENCY_BAND[1])}`;
  const effSeries = yearSeries(
    effPoints,
    years,
    currentYear,
    (p) => ({ x: p.pace, y: p.hr, lines: [p.ymd, `${formatPace(p.pace)}/km · ${p.hr}bpm · ${km1(p.distanceM)}${p.race ? " · 레이스" : ""}`], href: activityHref(p.id) }),
    (p) => p.race,
  );

  // B
  const wxPoints = weatherPoints(runs);
  const bins = paceByTempBin(wxPoints);
  const heat = heatPenalty(bins);
  const wxSeries: ScatterSeries[] = ([0, 1, 2] as const).map((level) => ({
    id: `h${level}`,
    label: HUMIDITY_LABELS[level],
    color: HUMIDITY_COLORS[level],
    points: wxPoints
      .filter((p) => p.humidity === level)
      .map((p) => ({
        x: p.tempC,
        y: p.pace,
        lines: [p.ymd, `${Math.round(p.tempC)}°C${p.humidityPct !== null ? ` · 습도 ${p.humidityPct}%` : ""} · ${formatPace(p.pace)}/km · ${km1(p.distanceM)}`],
        href: activityHref(p.id),
      })),
  }));

  // C — 필터 전 러닝 (존은 거리와 무관)
  const zoneMonths = zoneShareByMonth(allRuns, ctx);
  const zoneCmp = zoneShareCompare(zoneMonths, ctx);
  const zoneFrom = zoneMonths[0]?.key.replace("-", ".") ?? null;

  // D
  const lagRs = lagCorrelations(weeks.buckets, LAGS, ctx);
  const pairs1 = lagPairs(weeks.buckets, 1, ctx);
  const lagSeries = yearSeries(pairs1, [...new Set(pairs1.map((p) => p.year))].sort((a, b) => a - b), currentYear, (p) => ({
    x: p.km,
    y: p.rhr,
    lines: [`${p.weekKey} 주`, `${p.km.toFixed(1)}km → 다음 주 안정시 심박 ${Math.round(p.rhr)}bpm`],
    href: null,
  }));
  const kmBands = kmBandTable(pairs1);

  return (
    <div>
      <h1 className="text-[22px] font-semibold tracking-tight text-bright sm:text-[26px]">분석</h1>
      <p className="mb-5 mt-1.5 max-w-[640px] text-[13px] text-sub">
        지표 하나의 추이가 아니라 <span className="font-medium text-muted">두 값의 관계</span>를 봅니다. {filterNote}. 각 패널의 제목이 질문이고, 아래 숫자가 답입니다.
      </p>

      <InsightPanel
        question="같은 페이스, 더 낮은 심박?"
        how="점 = 러닝 1건. 가로 = 평균 페이스 (오른쪽이 빠름), 세로 = 평균 심박. 올해만 색, 지난 해는 최근일수록 밝은 회색. 속 빈 점 = 레이스"
        foot={`기준 구간 ${band}/km 은 평균 페이스 근처의 30초 폭. 5건 미만인 해는 —. 같은 페이스끼리만 비교되므로 느린 회복 러닝은 표에 섞이지 않습니다.`}
      >
        {effPoints.length > 0 ? (
          <InsightScatter
            series={effSeries}
            x={{ label: "페이스 /km → 빠름", reversed: true, format: "pace" }}
            y={{ label: "bpm", format: "int" }}
            ariaLabel="페이스 대비 평균 심박 산점도"
            toggle
          />
        ) : (
          <p className="py-10 text-center text-[13px] text-dim">심박이 기록된 러닝이 없습니다.</p>
        )}
        <Answer>
          <BigNumber
            label={`${band} 구간 · 올해 vs ${effDelta?.firstYear ?? "첫 해"}`}
            text={effDelta ? signed(effDelta.delta) : null}
            unit="bpm"
            caption={effDelta ? `${effDelta.from} → ${effDelta.to} bpm · 같은 페이스로 달릴 때` : "기준 구간에 5건 이상인 해가 둘 이상 필요"}
          />
          <ValueTable corner="해" headers={effYears.map((y) => String(y.year))} rowLabel="평균 심박" cells={effYears.map((y) => ({ text: y.avgHr === null ? null : String(y.avgHr), n: y.n }))} />
        </Answer>
      </InsightPanel>

      <InsightPanel
        question="여름이 페이스를 얼마나 깎나?"
        how="가로 = 러닝 당시 기온 (외부 기상 · 손목 온도 아님), 세로 = 평균 페이스 (위가 빠름). 점 색 = 습도 3단"
        foot="평균이 아니라 중앙값 — 레이스 · 회복 러닝 같은 극단값에 덜 흔들립니다. 5건 미만 구간은 —."
      >
        {wxPoints.length > 0 ? (
          <InsightScatter
            series={wxSeries}
            x={{ label: "기온 °C", format: "degrees" }}
            y={{ label: "페이스 /km ↑ 빠름", reversed: true, format: "pace" }}
            ariaLabel="기온 대비 페이스 산점도"
            toggle={false}
          />
        ) : (
          <p className="py-10 text-center text-[13px] text-dim">기온이 기록된 러닝이 없습니다.</p>
        )}
        <Answer>
          <BigNumber
            label="30°C 이상 vs 10~15°C"
            text={heat ? signed(heat.deltaSec) : null}
            unit="초/km"
            caption={heat ? `중앙값 ${formatPace(heat.mild.medianPace as number)} → ${formatPace(heat.hot.medianPace as number)}` : "두 구간 모두 5건 이상 필요"}
          />
          <ValueTable corner="기온 °C" headers={bins.map((b) => b.label)} rowLabel="중앙값 페이스" cells={bins.map((b) => ({ text: b.medianPace === null ? null : formatPace(b.medianPace), n: b.n }))} />
        </Answer>
      </InsightPanel>

      <InsightPanel
        question="강도 배분이 달라졌나?"
        how={`달마다 심박 존 1~5 에 머문 시간의 비율.${zoneFrom ? ` 존 분포는 ${zoneFrom} 부터 있습니다` : ""}`}
        foot="존 있는 러닝이 그 달 러닝의 절반 미만이면 흐리게, 이번 달은 점선. 비교 값은 그런 달을 뺀 달 평균입니다."
      >
        {zoneMonths.length > 0 ? (
          <>
            <ZoneStack months={zoneMonths} />
            <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-sub">
              {ZONE_NAMES.map((name, z) => (
                <li key={name} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: ZONE_COLORS[z] }} />
                  존 {z + 1} {name}
                </li>
              ))}
              <li>흐린 막대 = 존 있는 러닝이 절반 미만인 달 · 점선 = 아직 끝나지 않은 달</li>
            </ul>
          </>
        ) : (
          <p className="py-10 text-center text-[13px] text-dim">심박 존 분포가 있는 러닝이 없습니다.</p>
        )}
        <ReadoutRow
          items={[
            { label: "이지 비율 (존 1~2) · 최근 12개월", text: pct(zoneCmp.recent.easy), caption: `${zoneCmp.recent.months}개 달` },
            { label: "그 전 12개월", text: pct(zoneCmp.previous.easy), caption: `${zoneCmp.previous.months}개 달` },
            {
              label: "고강도 (존 4~5) 최근 · 이전",
              text: zoneCmp.recent.hard === null ? null : `${pct(zoneCmp.recent.hard)} · ${pct(zoneCmp.previous.hard) ?? "—"}`,
              caption: "존 4~5 시간 비율",
            },
          ]}
        />
      </InsightPanel>

      <InsightPanel
        question="많이 뛴 다음 주, 안정시 심박이 오르나?"
        how="점 = 한 주. 가로 = 그 주 러닝 거리, 세로 = 다음 주 평균 안정시 심박. 끝나지 않은 주 · 심박 기록이 절반 미만인 주는 뺐습니다"
        foot="r 은 피어슨 상관계수. 통계 검정이 아니라 방향과 크기의 감각입니다 — 0.1 미만은 관계 없음, 0.3 이상이면 관계 있음으로 읽습니다."
      >
        {pairs1.length > 0 ? (
          <InsightScatter
            series={lagSeries}
            x={{ label: "주간 km", format: "int" }}
            y={{ label: "다음 주 bpm", format: "int" }}
            ariaLabel="주간 거리 대비 다음 주 안정시 심박 산점도"
            toggle
          />
        ) : (
          <p className="py-10 text-center text-[13px] text-dim">비교할 완결된 주가 아직 없습니다.</p>
        )}
        <ReadoutRow
          items={lagRs.map((x) => ({
            label: `상관 r · ${x.lag === 0 ? "같은 주" : `${x.lag}주 뒤`}`,
            text: x.r === null ? null : signed(x.r, 2),
            caption: `${correlationWord(x.r) ?? "쌍 3개 미만"} · n=${x.n}`,
          }))}
        />
        <div className="mt-3.5">
          <ValueTable corner="주간 km" headers={kmBands.map((b) => b.label)} rowLabel="다음 주 평균 심박" cells={kmBands.map((b) => ({ text: b.avgRhr === null ? null : b.avgRhr.toFixed(1), n: b.n }))} />
        </div>
      </InsightPanel>
    </div>
  );
}
