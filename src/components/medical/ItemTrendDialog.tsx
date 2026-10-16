"use client";

// #527 (2/2): 항목 추이 — 회차별 선 + 기준범위 띠 (최근 회차 기준) + 판정 색 점 + 이력 표. 정성 항목은 배지 줄.
// 데스크톱은 가운데 다이얼로그, 모바일은 바텀시트 (<dialog> · Esc · 배경 클릭으로 닫힘).
import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ItemTrendDto, TrendPointDto } from "@/lib/checkup/dto";
import { FLAG_LABEL, flagTone, formatResultValue, itemDecimals, splitTrendByUnit, visualRange } from "@/lib/checkup/view";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_TOOLTIP_CLASS } from "@/components/trends/chart-format";
import { FLAG_PILL, valueClass } from "./flag-style";
import type { CheckupMedication, ItemMedicationsDto } from "@/lib/medication/link";
import { PILL, medPillClass, medPillText } from "./meds/med-style";

interface ItemTrendDialogProps {
  itemCode: string | null;
  onClose: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; trend: ItemTrendDto; meds: ItemMedicationsDto };

const NO_MEDS: ItemMedicationsDto = { related: [], byCheckup: {} };
/** 응답을 요청한 항목 code 와 함께 둔다 — 다른 항목을 열면 code 가 달라 곧바로 '불러오는 중' (effect 안 setState 없이) */
type Loaded = { code: string; state: LoadState };

const TONE_COLOR = { caution: "#fcd34d", abnormal: "#f87171", none: "#ededed" } as const;

export default function ItemTrendDialog({ itemCode, onClose }: ItemTrendDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const state: LoadState = loaded && loaded.code === itemCode ? loaded.state : { status: "loading" };

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (itemCode && !dialog.open) dialog.showModal();
    if (!itemCode && dialog.open) dialog.close();
  }, [itemCode]);

  useEffect(() => {
    if (!itemCode) return;
    const controller = new AbortController();
    fetch(`/api/checkups/items/${encodeURIComponent(itemCode)}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `불러오지 못했습니다 (${res.status})`);
        setLoaded({
          code: itemCode,
          state: { status: "ready", trend: body.trend as ItemTrendDto, meds: (body.medications as ItemMedicationsDto | undefined) ?? NO_MEDS },
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({ code: itemCode, state: { status: "error", message: err instanceof Error ? err.message : "불러오지 못했습니다" } });
      });
    return () => controller.abort();
  }, [itemCode]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="trend-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="m-auto mb-0 w-screen max-w-none rounded-t-2xl border border-border-hover bg-card p-0 text-muted backdrop:bg-black/60 md:mb-auto md:w-[min(640px,calc(100vw-32px))] md:rounded-2xl"
    >
      <div className="p-5">
        {state.status === "loading" && <p className="text-sm text-dim">불러오는 중…</p>}
        {state.status === "error" && <p className="text-sm text-sub">{state.message}</p>}
        {state.status === "ready" && <TrendBody trend={state.trend} meds={state.meds} />}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => ref.current?.close()} className="rounded-lg px-3 py-1.5 text-sm text-sub hover:text-bright">
            닫기
          </button>
        </div>
      </div>
    </dialog>
  );
}

function TrendBody({ trend, meds }: { trend: ItemTrendDto; meds: ItemMedicationsDto }) {
  const latest = trend.points[trend.points.length - 1];
  const numeric = trend.points.some((p) => p.valueNum !== null);
  const { plotted, excluded } = splitTrendByUnit(trend.points);
  return (
    <>
      <h2 id="trend-title" className="text-lg font-semibold text-bright">
        {trend.label}
      </h2>
      <p className="text-xs text-sub">
        {trend.category}
        {trend.unit ? ` · ${trend.unit}` : numeric ? "" : " · 정성 결과"}
        {latest.refText ? ` · 기준범위 ${latest.refText} (최근 회차)` : ""}
      </p>
      {numeric ? <TrendChart trend={trend} points={plotted} /> : <QualitativeRow points={trend.points} itemCode={trend.itemCode} />}
      {excluded > 0 && (
        <p className="mt-1.5 text-xs text-amber-300">
          차트에서 뺀 회차 {excluded}개 (단위 다름) — 아래 이력 표에서 확인하세요. 값을 직접 비교하지 마세요.
        </p>
      )}
      <RelatedMeds meds={meds} />
      <HistoryTable trend={trend} meds={meds} />
    </>
  );
}

/** points: 최근 회차와 단위가 같은 수치 점만 (splitTrendByUnit · #531) */
function TrendChart({ trend, points }: { trend: ItemTrendDto; points: readonly TrendPointDto[] }) {
  const latest = points[points.length - 1];
  const [low, high] = visualRange(latest.refLow, latest.refHigh);
  const rows = points.map((p) => ({ ...p, x: p.date.slice(0, 7) }));
  const values = rows.map((r) => r.valueNum as number).concat([low, high].filter((v): v is number => v !== null));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || Math.abs(max) || 1) * 0.3;
  // 0 아래로 내려가지 않게 자르는 건 값이 모두 0 이상일 때만 — 음수 값 · 기준범위 (사용자 항목) 는 그대로 (#533)
  const domain: [number, number] = [min >= 0 ? Math.max(0, min - pad) : min - pad, max + pad];

  return (
    <div className="mt-3 h-[220px]" role="img" aria-label={`${trend.label} 회차별 추이`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 20, right: 24, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_GRID_STROKE} />
          {(low !== null || high !== null) && (
            <ReferenceArea
              y1={low ?? domain[0]}
              y2={high ?? domain[1]}
              fill="#22c55e"
              fillOpacity={0.12}
              stroke="#22c55e"
              strokeOpacity={0.4}
              strokeDasharray="3 3"
              ifOverflow="hidden"
              style={{ pointerEvents: "none" }}
            />
          )}
          <XAxis dataKey="x" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} interval={0} padding={{ left: 16, right: 16 }} />
          <YAxis
            domain={domain}
            axisLine={false}
            tickLine={false}
            tick={CHART_AXIS_TICK}
            width={44}
            tickCount={4}
            tickFormatter={(v: number) => v.toFixed(itemDecimals(trend.itemCode, latest.valueText))}
          />
          <Tooltip
            cursor={{ stroke: "#333", pointerEvents: "none" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as (TrendPointDto & { x: string }) | undefined) : undefined;
              if (!p) return null;
              const tone = flagTone(p.flag);
              return (
                <div className={CHART_TOOLTIP_CLASS}>
                  <div className="text-dim">{p.date}</div>
                  <div className={valueClass(tone)}>
                    {formatResultValue({ ...p, itemCode: trend.itemCode })} {p.unit ?? ""}
                    {tone ? ` · ${FLAG_LABEL[tone]}` : ""}
                  </div>
                </div>
              );
            }}
          />
          <Line
            dataKey="valueNum"
            stroke="#a3a3a3"
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={(props) => {
              const { cx, cy, payload, index } = props as { cx: number; cy: number; payload: (typeof rows)[number]; index: number };
              const color = TONE_COLOR[flagTone(payload.flag) ?? "none"];
              return (
                <g key={index}>
                  <circle cx={cx} cy={cy} r={5} fill={color} stroke={color} strokeWidth={1.5} />
                  <text x={cx} y={cy - 10} textAnchor="middle" fontSize={12} fill={color} fontFamily="var(--font-geist-mono)">
                    {formatResultValue({ ...payload, itemCode: trend.itemCode })}
                  </text>
                </g>
              );
            }}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function QualitativeRow({ points, itemCode }: { points: readonly TrendPointDto[]; itemCode: string }) {
  return (
    <ol className="my-4 flex flex-wrap gap-3">
      {points.map((p) => {
        const tone = flagTone(p.flag);
        return (
          <li key={p.checkupId} className="text-center">
            <span className={`rounded-md px-2 py-0.5 text-xs ${tone ? FLAG_PILL[tone] : "bg-surface text-muted"}`}>
              {formatResultValue({ ...p, itemCode })}
            </span>
            <span className="mt-1 block font-[family-name:var(--font-geist-mono)] text-[11px] text-dim">{p.date.slice(0, 7)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** #544: 이 항목을 관련 항목으로 지정한 약 — 기간 · 복용 중 */
function RelatedMeds({ meds }: { meds: ItemMedicationsDto }) {
  if (meds.related.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <h3 className="mb-1.5 text-xs font-medium text-sub">관련 복약</h3>
      <ul className="space-y-1">
        {meds.related.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className={`${PILL} ${medPillClass(m)}`}>{medPillText(m)}</span>
            <span className="text-bright">{m.name}</span>
            <span className="font-[family-name:var(--font-geist-mono)] text-xs text-sub">
              {m.startDate} ~ {m.endDate ?? "복용 중"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MedBadge({ med }: { med: CheckupMedication }) {
  const when =
    med.endedDaysBefore === null ? "" : med.endedDaysBefore === 0 ? " · 검진일 복용" : ` · ${med.endedDaysBefore}일 전까지`;
  return (
    <span
      className={`${PILL} ${medPillClass(med)}`}
      title={med.regimen === "short_term" ? "검진일 앞 14일 안 단기 복용" : "관련 항목으로 지정한 장기 복용"}
    >
      {med.name}
      {when}
    </span>
  );
}

function HistoryTable({ trend, meds }: { trend: ItemTrendDto; meds: ItemMedicationsDto }) {
  const showMeds = Object.values(meds.byCheckup).some((list) => list.length > 0);
  return (
    <table className="mt-2 w-full border-collapse text-[13px]">
      <thead>
        <tr className="text-left text-[11px] text-dim">
          <th className="py-1.5 font-normal">검진일</th>
          <th className="py-1.5 font-normal">결과</th>
          <th className="py-1.5 font-normal">기준범위</th>
          <th className="hidden py-1.5 font-normal sm:table-cell">기관</th>
          {showMeds && <th className="py-1.5 font-normal">그때 먹던 약</th>}
        </tr>
      </thead>
      <tbody>
        {[...trend.points].reverse().map((p) => {
          const tone = flagTone(p.flag);
          return (
            <tr key={p.checkupId} className="border-t border-border">
              <td className="py-1.5 font-[family-name:var(--font-geist-mono)]">{p.date}</td>
              <td className="py-1.5 font-[family-name:var(--font-geist-mono)]">
                <span className={valueClass(tone)}>{formatResultValue({ ...p, itemCode: trend.itemCode })}</span>
                {p.unit && <span className="ml-1 text-xs text-dim">{p.unit}</span>}
                {tone && <span className={`ml-1.5 text-[11px] ${valueClass(tone)}`}>{FLAG_LABEL[tone]}</span>}
              </td>
              <td className="py-1.5 font-[family-name:var(--font-geist-mono)] text-sub">{p.refText ?? ""}</td>
              <td className="hidden py-1.5 text-sub sm:table-cell">{p.institution ?? ""}</td>
              {showMeds && (
                <td className="py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {(meds.byCheckup[p.checkupId] ?? []).map((m) => (
                      <MedBadge key={m.id} med={m} />
                    ))}
                  </span>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
