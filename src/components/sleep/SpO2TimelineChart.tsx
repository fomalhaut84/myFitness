"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import {
  buildSpO2ChartSeries,
  spo2ChartYAxis,
  type SpO2Point,
} from "@/lib/garmin/sleep-spo2-series";
import { formatEpochKST } from "@/lib/format";

// docs/designs/342-sleep-spo2-chart/design-notes.md 참조.
// sky-400 — 산소/호흡의 냉색. SleepScoreChart 의 바이올렛(#a78bfa)과 의도적으로 분리해
// 같은 페이지의 두 차트가 같은 지표로 읽히지 않게 한다.
const ACCENT = "#38bdf8";
// fuchsia-300 — "가장 주목할 지점" 이지 "위험" 이 아니다. 절대 임계 경고 금지 정책(#338) 정합.
const LOW_MARK = "#f0abfc";
const RULE = "#333333";
const AXIS = "#525252";

interface SpO2TimelineChartProps {
  series: SpO2Point[];
}

export default function SpO2TimelineChart({ series }: SpO2TimelineChartProps) {
  // 측정하지 않은 야간은 카드 자체를 렌더하지 않는다 — 빈 차트보다 부재가 정직하다.
  if (series.length === 0) return null;

  let min = series[0].v;
  let lowestAt = series[0].t;
  for (const p of series) {
    if (p.v < min) {
      min = p.v;
      lowestAt = p.t;
    }
  }

  // SpO2 는 좁은 대역에서 의미가 발생한다. [0,100] 이면 실제 변동이 하단에 눌려
  // 차트가 거의 직선으로 보인다. 하한·눈금은 spo2ChartYAxis 가 함께 결정한다
  // (하한을 임의로 막으면 Recharts 가 domain 을 데이터에 맞춰 되늘려 무효가 된다).
  const { yMin, ticks: yTicks } = spo2ChartYAxis(min);

  // X축은 수치 시간축. 카테고리 축(HH:mm label)을 쓰면 센서 공백이 압축되어 60분
  // dropout 이 1분 간격과 같은 거리로 그려진다 — "언제 · 얼마나 오래" 를 오독하게 만든다.
  // 공백 구간은 buildSpO2ChartSeries 가 null 포인트로 끊는다.
  const data = buildSpO2ChartSeries(series);

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div className="text-[11px] text-dim tracking-wider uppercase">야간 SpO2</div>
        <div className="text-[11px] text-sub font-[family-name:var(--font-geist-mono)]">
          최저 {Math.round(min)}% · {formatEpochKST(lowestAt)}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spo2Fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatEpochKST}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: AXIS }}
            minTickGap={48}
          />
          <YAxis
            domain={[yMin, 100]}
            ticks={yTicks}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: AXIS }}
            width={30}
          />

          {/* "기준" 이 아니라 "참고" — 눈금 보조일 뿐 경고 의미를 싣지 않는다. */}
          <ReferenceLine
            y={90}
            stroke={RULE}
            strokeDasharray="3 3"
            label={{
              value: "참고 90%",
              position: "insideTopRight",
              fontSize: 9,
              fill: AXIS,
            }}
          />

          <Tooltip
            contentStyle={{
              backgroundColor: "#1e1e1e",
              border: "1px solid #333333",
              borderRadius: 8,
              fontSize: 13,
              color: "#ededed",
            }}
            itemStyle={{ color: "#ededed" }}
            labelStyle={{ color: "#a3a3a3" }}
            formatter={(value) => [
              typeof value === "number" ? `${Math.round(value)}%` : String(value),
              "SpO2",
            ]}
            // 축 tick 과 마찬가지로 Date 가 올 수 있다 — formatEpochKST 가 정규화한다.
            labelFormatter={(label) =>
              typeof label === "number" || label instanceof Date
                ? formatEpochKST(label)
                : String(label)
            }
          />

          <Area
            type="monotone"
            dataKey="v"
            stroke={ACCENT}
            strokeWidth={1.5}
            fill="url(#spo2Fill)"
            dot={false}
            // 센서 공백 위를 직선이 가로지르지 않게 한다.
            connectNulls={false}
            // 400+ 포인트에서 진입 애니메이션은 비용만 크다.
            isAnimationActive={false}
          />

          <ReferenceDot x={lowestAt} y={min} r={3.5} fill={LOW_MARK} stroke="none" />
        </AreaChart>
      </ResponsiveContainer>

      <div className="text-[11px] text-dim mt-3">
        손목 센서 특성상 80대 중반의 단발 저점은 정상 범위입니다. 개인 평소 수준 대비 추이로 보세요.
      </div>
    </div>
  );
}
