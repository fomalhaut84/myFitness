// #342 야간 SpO2 그래프 — 승인된 프로토타입 (참조용)
// 실제 구현: src/components/sleep/SpO2TimelineChart.tsx
//
// 디자인 결정 근거는 design-notes.md 참조. 특히:
// - Y축 [80,100] 고정 (0-100 이면 실변동이 눌림)
// - 최저 지점은 경고색 아님 (fuchsia-300) — v2.26.2 절대임계 금지 정책 정합
// - readingConfidence 필터링 없음

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  defs,
} from "recharts";

const ACCENT = "#38bdf8";       // sky-400 — 산소/호흡. SleepScoreChart 바이올렛과 의도적 분리
const LOW_MARK = "#f0abfc";     // fuchsia-300 — "주목" 이지 "위험" 아님
const RULE = "#333333";
const AXIS = "#525252";

function fmtKST(ms) {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export default function SpO2TimelineChart({ series }) {
  if (!series || series.length === 0) return null;   // 부재가 빈 차트보다 정직

  const values = series.map((p) => p.v);
  const min = Math.min(...values);
  const lowest = series.find((p) => p.v === min);

  // 실변동이 눌리지 않도록 하단을 80 으로 올린다. 80 미만이면 그만큼 확장.
  const yMin = Math.min(80, min - 2);

  const data = series.map((p) => ({ t: p.t, label: fmtKST(p.t), v: p.v }));

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-[11px] text-dim tracking-wider uppercase">야간 SpO2</div>
        <div className="text-[11px] text-sub font-[family-name:var(--font-geist-mono)]">
          최저 {min}% · {fmtKST(lowest.t)}
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
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: AXIS }}
            interval="preserveStartEnd"
            minTickGap={48}
          />
          <YAxis
            domain={[yMin, 100]}
            ticks={[yMin, 90, 95, 100]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: AXIS }}
            width={30}
          />

          {/* "기준" 아닌 "참고" — 경고 의미를 싣지 않는다 */}
          <ReferenceLine
            y={90}
            stroke={RULE}
            strokeDasharray="3 3"
            label={{ value: "참고 90%", position: "insideTopRight", fontSize: 9, fill: AXIS }}
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
            formatter={(v) => [`${v}%`, "SpO2"]}
          />

          <Area
            type="monotone"
            dataKey="v"
            stroke={ACCENT}
            strokeWidth={1.5}
            fill="url(#spo2Fill)"
            dot={false}
            isAnimationActive={false}   // 400+ 포인트에서 애니메이션은 비용만 큼
          />

          <ReferenceDot x={lowest.label} y={min} r={3.5} fill={LOW_MARK} stroke="none" />
        </AreaChart>
      </ResponsiveContainer>

      <div className="text-[11px] text-dim mt-3">
        손목 센서 특성상 80대 중반의 단발 저점은 정상 범위입니다. 개인 평소 수준 대비 추이로 보세요.
      </div>
    </div>
  );
}
