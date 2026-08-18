"use client";

// #299: 7일 단백질 g/kg 트렌드. pure SVG · 목표선 · 미달 일자 붉은 점.

export interface ProteinTrendPoint {
  date: string;         // YYYY-MM-DD
  proteinG: number | null;
}

interface Props {
  data: ProteinTrendPoint[];
  targetPerKg: number;
  bodyWeightKg: number | null;
}

const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

function dayLabel(iso: string): string {
  // "YYYY-MM-DD" → 요일 (월/화/…)
  const d = new Date(`${iso}T00:00:00+09:00`);
  return ["일","월","화","수","목","금","토"][d.getDay()];
}

export default function ProteinTrend({ data, targetPerKg, bodyWeightKg }: Props) {
  const W = 320, H = 160, PAD_L = 30, PAD_R = 12, PAD_T = 12, PAD_B = 24;
  const perKg = data.map((d) => ({
    date: d.date,
    day: dayLabel(d.date),
    value: d.proteinG !== null && bodyWeightKg ? d.proteinG / bodyWeightKg : null,
  }));
  const yMin = 0.5, yMax = 2.4;
  const xStep = perKg.length > 1 ? (W - PAD_L - PAD_R) / (perKg.length - 1) : 0;
  const yScale = (v: number): number => PAD_T + (yMax - v) / (yMax - yMin) * (H - PAD_T - PAD_B);
  const xScale = (i: number): number => PAD_L + i * xStep;
  const points = perKg.map((d, i) => ({
    ...d,
    x: xScale(i),
    y: d.value !== null ? yScale(Math.min(Math.max(d.value, yMin), yMax)) : null,
    miss: d.value !== null && d.value < targetPerKg,
  }));
  const targetY = yScale(targetPerKg);
  const valid = points.filter((p): p is (typeof p & { y: number; value: number }) => p.y !== null && p.value !== null);
  const linePath = valid.length > 1
    ? "M " + valid.map((p) => `${p.x} ${p.y}`).join(" L ")
    : "";
  const yTicks = [0.5, 1.0, 1.5, 2.0];
  const misses = points.filter((p) => p.value !== null && p.value < targetPerKg).length;
  const validVals = points.filter((p) => p.value !== null).map((p) => p.value as number);
  const avg = validVals.length > 0 ? fmt1(validVals.reduce((s, v) => s + v, 0) / validVals.length) : "—";
  const best = validVals.length > 0 ? fmt1(Math.max(...validVals)) : "—";

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-[10px] tracking-[0.22em] uppercase text-dim font-[family-name:var(--font-geist-mono)]">Protein</div>
          <h2 className="text-[17px] font-semibold mt-0.5">단백질 트렌드 · 7일</h2>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.2em] text-dim font-[family-name:var(--font-geist-mono)]">Target</div>
          <div className="text-[15px] font-[family-name:var(--font-geist-mono)] text-bright">
            {fmt1(targetPerKg)} <span className="text-[11px] text-dim">g/kg</span>
          </div>
        </div>
      </div>
      <div className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[180px]">
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yScale(v)} y2={yScale(v)} stroke="var(--border)" strokeDasharray="2 4" />
              <text x={PAD_L - 6} y={yScale(v) + 3} textAnchor="end" fontSize="10" fill="var(--dim)" fontFamily="var(--font-geist-mono), monospace">{v.toFixed(1)}</text>
            </g>
          ))}
          <line x1={PAD_L} x2={W - PAD_R} y1={targetY} y2={targetY} stroke="var(--accent)" strokeWidth="1.4" strokeDasharray="4 3" opacity="0.7" />
          <text x={W - PAD_R} y={targetY - 4} textAnchor="end" fontSize="9" fill="var(--accent)" fontFamily="var(--font-geist-mono), monospace" letterSpacing="1">TARGET {fmt1(targetPerKg)}</text>
          {linePath && <path d={linePath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          {points.map((p, i) => (
            <g key={i}>
              {p.y !== null && (
                <>
                  <circle cx={p.x} cy={p.y} r="4.5"
                    fill={p.miss ? "#dc2626" : "#22c55e"}
                    stroke="var(--bg)" strokeWidth="2.5" />
                  <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="9"
                    fill={p.miss ? "#fca5a5" : "var(--sub)"}
                    fontFamily="var(--font-geist-mono), monospace">
                    {p.value !== null ? fmt1(p.value) : ""}
                  </text>
                </>
              )}
              <text x={p.x} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--dim)" fontFamily="var(--font-geist-mono), monospace">{p.day}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-3 gap-3 text-center">
        {[
          { label:"목표 미달", value:`${misses}일`, clr: misses >= 3 ? "#fca5a5" : misses > 0 ? "#fcd34d" : "var(--bright)" },
          { label:"평균", value:`${avg}${avg === "—" ? "" : " g/kg"}`, clr:"var(--bright)" },
          { label:"최고", value:`${best}${best === "—" ? "" : " g/kg"}`, clr: best === "—" ? "var(--bright)" : "#6ee7b7" },
        ].map((s, i) => (
          <div key={i}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-dim font-[family-name:var(--font-geist-mono)] mb-0.5">{s.label}</div>
            <div className="text-[15px] font-[family-name:var(--font-geist-mono)]" style={{ color: s.clr }}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
