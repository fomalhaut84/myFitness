"use client";

// #418: 활동 상세 "종료 후 회복" — 2분 격자 위의 점 7개 (−4 … +10 분) + 2분 HRR · 10분 낙차. 시안 `docs/designs/418-hr-recovery/`.
// 곡선은 점을 잇는 안내선일 뿐 (보간 없음). 결측은 자리를 비우지 않고 점선 빈 원, 선은 거기서 끊긴다.
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatTimeKST } from "@/lib/format";
import type { RecoveryDTO } from "@/lib/heart/load-recovery";

const HR_COLOR = "#f87171";
const PRE_COLOR = "#525252";
const CARD_BG = "#161616";
const X_DOMAIN: [number, number] = [-5, 11];
const Y_PAD = 8;
/** Y 눈금은 10 단위 · 최대 5개 (10 → 20 → 30 …) */
const Y_STEP_BASE = 10;
const Y_MAX_TICKS = 5;
/** 낙차 브래킷의 x (데이터 좌표 · +2 점 오른쪽) */
const BRACKET_X = 2.55;
const CHART_HEIGHT = 170;

interface Row {
  offsetMin: number;
  bpm: number | null;
  /** 결측 점의 자리 (y 중앙) — 점선 빈 원만 그리는 보조 계열 */
  missY: number | null;
}

const offsetLabel = (m: number) => (m === 0 ? "0" : `${m > 0 ? "+" : "−"}${Math.abs(m)}`);
/** 양수 = 회복. 음수는 부호 그대로 (종료 뒤 심박 상승) */
const signed = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v)}`;

/** [lo, hi] 를 10 단위로 넓히고 눈금을 최대 5개로 — 69 · 94 · 119 같은 어중간한 눈금을 피한다 */
function yScale(minBpm: number, maxBpm: number): { lo: number; hi: number; ticks: number[] } {
  const lo = Math.floor((minBpm - Y_PAD) / Y_STEP_BASE) * Y_STEP_BASE;
  const hi = Math.ceil((maxBpm + Y_PAD) / Y_STEP_BASE) * Y_STEP_BASE;
  let step = Y_STEP_BASE;
  while ((hi - lo) / step + 1 > Y_MAX_TICKS) step += Y_STEP_BASE;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  return { lo, hi, ticks };
}

export default function RecoverySection({ recovery }: { recovery: RecoveryDTO }) {
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">종료 후 회복</h2>
        <span className="text-[11px] text-dim">2분 해상도</span>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
        <Body recovery={recovery} />
      </div>
    </div>
  );
}

function Body({ recovery }: { recovery: RecoveryDTO }) {
  if (!recovery.hasRecord) return <Empty>이 날 심박 기록이 없습니다. 하루 심박이 싱크된 날의 러닝에서만 보입니다.</Empty>;
  if (recovery.postSamples < 2) return <Empty>종료 후 샘플이 부족합니다. 워치를 바로 벗었을 수 있어요.</Empty>;

  const end = recovery.points.find((p) => p.offsetMin === 0)?.bpm ?? null;
  const at2 = recovery.points.find((p) => p.offsetMin === 2)?.bpm ?? null;
  const at10 = recovery.points.find((p) => p.offsetMin === 10)?.bpm ?? null;
  const rose = recovery.hrr2 !== null && recovery.hrr2 < 0;
  const endLabel = formatTimeKST(recovery.endIso);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_200px]">
        <RecoveryChart recovery={recovery} endLabel={endLabel} />
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-1">
          <Readout label="2분 HRR" value={recovery.hrr2} caption={end !== null && at2 !== null ? `${end} → ${at2} bpm` : undefined} />
          <Readout label="10분 낙차" value={recovery.drop10} caption={end !== null && at10 !== null ? `${end} → ${at10} bpm` : undefined} />
        </dl>
      </div>
      <p className={`mt-2.5 text-[11px] ${rose ? "text-sub" : "text-dim"}`}>
        {rose && "종료 뒤에도 심박이 올랐어요 — 쿨다운 없이 멈췄거나 종료 시각이 어긋났을 수 있습니다. "}
        하루 심박 기록의 2분 샘플 — 워치의 1분 HRR 과 다릅니다. 점은 ±60초 안의 가장 가까운 샘플.
      </p>
    </>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="py-7 text-center text-[13px] text-dim">{children}</p>;
}

function Readout({ label, value, caption }: { label: string; value: number | null; caption?: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg px-3.5 py-3">
      <dt className="text-[11px] text-sub">{label}</dt>
      {value === null ? (
        <dd className="mt-1 text-[13px] text-dim">—</dd>
      ) : (
        <dd className="mt-1 font-[family-name:var(--font-geist-mono)] text-[26px] font-medium leading-tight tracking-tight text-bright">
          {signed(value)}
          <span className="ml-1 text-[12px] font-normal text-sub">bpm</span>
          {caption && <span className="block font-sans text-[11px] font-normal text-sub">{caption}</span>}
        </dd>
      )}
    </div>
  );
}

function RecoveryChart({ recovery, endLabel }: { recovery: RecoveryDTO; endLabel: string }) {
  const valid = recovery.points.map((p) => p.bpm).filter((v): v is number => v !== null);
  const { lo, hi, ticks } = yScale(Math.min(...valid), Math.max(...valid));
  const mid = Math.round((lo + hi) / 2);
  const rows: Row[] = recovery.points.map((p) => ({ offsetMin: p.offsetMin, bpm: p.bpm, missY: p.bpm === null ? mid : null }));
  const end = rows.find((r) => r.offsetMin === 0)?.bpm ?? null;
  const at2 = rows.find((r) => r.offsetMin === 2)?.bpm ?? null;
  const bracket = end !== null && at2 !== null && end !== at2 ? { from: end, to: at2, label: `${end > at2 ? "↓" : "↑"}${Math.abs(end - at2)}` } : null;
  const ariaLabel = `종료 후 10분 심박: ${rows.map((r) => `${offsetLabel(r.offsetMin)}분 ${r.bpm ?? "결측"}`).join(", ")}`;

  return (
    <div role="img" aria-label={ariaLabel} style={{ height: CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 18, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#1f1f1f" vertical={false} />
          <XAxis
            type="number"
            dataKey="offsetMin"
            domain={X_DOMAIN}
            ticks={rows.map((r) => r.offsetMin)}
            tickFormatter={offsetLabel}
            tick={{ fontSize: 10, fill: "#525252", fontFamily: "var(--font-geist-mono)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis domain={[lo, hi]} ticks={ticks} tick={{ fontSize: 10, fill: "#525252", fontFamily: "var(--font-geist-mono)" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: "#333", pointerEvents: "none" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as Row | undefined;
              if (!active || !row) return null;
              return (
                <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-[family-name:var(--font-geist-mono)] text-sub">
                  {offsetLabel(row.offsetMin)}분 · {row.bpm === null ? "결측" : <span className="text-bright">{row.bpm} bpm</span>}
                </div>
              );
            }}
          />
          {/* 달리는 중 (종료 이전) — 심박 색 5% 띠 */}
          <ReferenceArea x1={X_DOMAIN[0]} x2={0} fill={HR_COLOR} fillOpacity={0.05} stroke="none" pointerEvents="none" />
          <ReferenceLine
            x={0}
            stroke="#737373"
            strokeDasharray="3 3"
            pointerEvents="none"
            label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) =>
              viewBox?.x === undefined || viewBox.y === undefined ? null : (
                <text x={viewBox.x} y={viewBox.y - 6} textAnchor="middle" fontSize={10} fill="#737373" className="font-[family-name:var(--font-geist-mono)]">
                  종료 {endLabel}
                </text>
              )
            }
          />
          <Line
            dataKey="bpm"
            stroke={HR_COLOR}
            strokeWidth={1.5}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={false}
            dot={({ cx, cy, payload, index }: { cx?: number; cy?: number; payload: Row; index: number }) =>
              cx === undefined || cy === undefined || payload.bpm === null ? (
                <g key={index} />
              ) : (
                <circle key={index} cx={cx} cy={cy} r={4} fill={payload.offsetMin < 0 ? PRE_COLOR : HR_COLOR} />
              )
            }
          />
          {/* 결측 점 — 점선 빈 원 (자리를 남긴다) */}
          <Line
            dataKey="missY"
            stroke="none"
            isAnimationActive={false}
            activeDot={false}
            tooltipType="none"
            dot={({ cx, cy, payload, index }: { cx?: number; cy?: number; payload: Row; index: number }) =>
              cx === undefined || cy === undefined || payload.missY === null ? (
                <g key={index} />
              ) : (
                <circle key={index} cx={cx} cy={cy} r={4} fill={CARD_BG} stroke="#525252" strokeDasharray="2 2" />
              )
            }
          />
          {/* 굵은 표현은 이것 하나 — 0 → +2 낙차 브래킷 */}
          {bracket && [
            <ReferenceLine key="b" segment={[{ x: BRACKET_X, y: bracket.from }, { x: BRACKET_X, y: bracket.to }]} stroke="#ededed" pointerEvents="none" />,
            <ReferenceDot
              key="l"
              x={BRACKET_X}
              y={(bracket.from + bracket.to) / 2}
              r={0}
              fill="none"
              stroke="none"
              pointerEvents="none"
              label={{ value: bracket.label, position: "right", fontSize: 12, fontWeight: 500, fill: "#ededed", fontFamily: "var(--font-geist-mono)" }}
            />,
          ]}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
