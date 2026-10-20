// M4-5 · #570: 활동 강도 분석 — 기준 배지 (심박 / 파워) · 고른 이유 · 존 범위 · 심박 · 파워 나란히 보기
import { POWER_ZONE_COLORS, POWER_ZONE_LABELS } from "@/lib/fitness/power-zones";

export interface ZoneDist {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

export interface ZoneRangeView {
  min: number | null;
  max: number | null;
}

export interface IntensitySide {
  dist: ZoneDist;
  label: string | null;
  score: number | null;
}

const HR_ZONES = [
  { name: "회복", color: "#a3a3a3" },
  { name: "이지", color: "#22c55e" },
  { name: "에어로빅", color: "#60a5fa" },
  { name: "역치", color: "#f59e0b" },
  { name: "VO2max", color: "#ef4444" },
];
// 파워 존은 심박 존보다 한 칸 위 — 색은 의미로 (power-zones.ts POWER_ZONE_COLORS)
const POWER_ZONES = POWER_ZONE_LABELS.map((name, i) => ({ name, color: POWER_ZONE_COLORS[i] }));

export const LABEL_META: Record<string, { text: string; badge: string }> = {
  recovery: { text: "회복 런", badge: "bg-slate-700 text-slate-200" },
  easy: { text: "이지 런", badge: "bg-green-900/40 text-green-300" },
  tempo: { text: "템포 런", badge: "bg-blue-900/40 text-blue-300" },
  threshold: { text: "한계치 런", badge: "bg-amber-900/40 text-amber-300" },
  interval: { text: "인터벌", badge: "bg-red-900/40 text-red-300" },
  max: { text: "최대 강도", badge: "bg-red-900/60 text-red-200" },
};

/** 기준을 고른 이유 (intensity-select.ts IntensityBasisReason) → 화면 문구. setting · normal 은 따로 말하지 않는다 */
export const BASIS_REASON_TEXT: Record<string, string> = {
  medication: "심박 영향 복약 기간",
  heat: "더위 (체감온도 높음)",
  no_power: "파워 기록 없음",
  no_hr: "심박 기록 없음",
};

function labelMeta(label: string) {
  return LABEL_META[label] ?? { text: label, badge: "bg-slate-700 text-slate-200" };
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function values(d: ZoneDist): number[] {
  return [d.z1, d.z2, d.z3, d.z4, d.z5];
}

function rangeText(r: ZoneRangeView | undefined, unit: string): string | null {
  if (!r) return null;
  if (r.min === null) return r.max === null ? null : `<${r.max + 1} ${unit}`;
  return r.max === null ? `${r.min}+ ${unit}` : `${r.min}–${r.max} ${unit}`;
}

export function BasisBadge({ basis }: { basis: "hr" | "power" }) {
  return basis === "power" ? (
    <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400">파워 기준</span>
  ) : (
    <span className="text-[11px] px-2 py-0.5 rounded bg-surface text-bright">심박 기준</span>
  );
}

function StackBar({ dist, power, label }: { dist: ZoneDist; power: boolean; label: string }) {
  const zones = power ? POWER_ZONES : HR_ZONES;
  const v = values(dist);
  const total = v.reduce((s, x) => s + x, 0);
  return (
    <div className="h-4 rounded bg-surface overflow-hidden flex" role="img" aria-label={label}>
      {zones.map((z, i) => {
        const pct = total > 0 ? (v[i] / total) * 100 : 0;
        if (pct <= 0) return null;
        return <div key={z.name} style={{ width: `${pct}%`, backgroundColor: z.color }} title={`Z${i + 1} ${z.name}: ${pct.toFixed(1)}%`} />;
      })}
    </div>
  );
}

export default function IntensityBreakdown({
  dist,
  label,
  score,
  zone,
  basis,
  reason,
  thresholdText,
  ranges,
  compare,
  avgHrNote,
}: {
  dist: ZoneDist;
  label: string;
  score: number | null;
  zone: number | null;
  basis: "hr" | "power";
  /** intensityBasisReason */
  reason: string | null;
  /** "역치파워 300 W" · "LTHR 165 bpm" */
  thresholdText: string | null;
  /** 존별 경계 (W 또는 bpm) — 없으면 열 생략 */
  ranges: ZoneRangeView[] | null;
  /** 두 값이 다 있는 러닝 — 나란히 보기 */
  compare: { hr: IntensitySide; power: IntensitySide } | null;
  /** "평균 심박 142 bpm (LTHR 대비 86%)" */
  avgHrNote: string | null;
}) {
  const power = basis === "power";
  const zones = power ? POWER_ZONES : HR_ZONES;
  const unit = power ? "W" : "bpm";
  const v = values(dist);
  const total = v.reduce((s, x) => s + x, 0);
  const meta = labelMeta(label);
  const reasonText = reason ? BASIS_REASON_TEXT[reason] : undefined;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">강도 분석</h2>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${meta.badge}`}>{meta.text}</span>
          {zone !== null && <span className="text-[11px] text-dim">Zone {zone}</span>}
          {score !== null && <span className="text-[11px] text-dim">{score.toFixed(0)}점</span>}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <BasisBadge basis={basis} />
          <span className="text-[12px] text-sub">{[reasonText, thresholdText].filter(Boolean).join(" · ")}</span>
        </div>

        <div className="mb-4">
          <StackBar dist={dist} power={power} label={power ? "러닝 파워 존 분포" : "심박 존 분포"} />
        </div>

        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1 text-[12px] items-center">
          {zones.map((z, i) => {
            const pct = total > 0 ? (v[i] / total) * 100 : 0;
            const r = rangeText(ranges?.[i], unit);
            return (
              <div key={z.name} className="contents">
                <span className="text-sub">
                  <i className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ backgroundColor: z.color }} />
                  Z{i + 1} {z.name}
                </span>
                <span className="text-dim font-[family-name:var(--font-geist-mono)]">{r ?? ""}</span>
                <span className="text-bright font-[family-name:var(--font-geist-mono)] text-right">{fmt(v[i])}</span>
                <span className="text-sub font-[family-name:var(--font-geist-mono)] text-right w-10">{pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
        {power && avgHrNote && !compare && <p className="text-[11px] text-dim mt-3">{avgHrNote} — 심박은 참고로만 보여 줍니다.</p>}
      </div>

      {compare && (
        <div className="bg-card border border-border rounded-xl p-5 mt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h3 className="text-[15px] font-semibold text-bright">심박 · 파워 나란히</h3>
            <span className="text-[12px] text-sub">같은 러닝을 두 기준으로</span>
          </div>
          <div className="space-y-2.5">
            {(["power", "hr"] as const).map((b) => {
              const side = compare[b];
              const m = side.label ? labelMeta(side.label) : null;
              return (
                <div key={b} className="grid grid-cols-[52px_1fr] sm:grid-cols-[52px_1fr_auto_44px] gap-2.5 items-center">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded text-center ${b === "power" ? "bg-amber-500/15 text-amber-400" : "bg-surface text-bright"}`}>
                    {b === "power" ? "파워" : "심박"}
                  </span>
                  <StackBar dist={side.dist} power={b === "power"} label={b === "power" ? "러닝 파워 존 분포" : "심박 존 분포"} />
                  <span className={`hidden sm:inline text-[11px] font-medium px-2 py-0.5 rounded ${m?.badge ?? "text-dim"}`}>{m?.text ?? "—"}</span>
                  <span className="hidden sm:inline text-[11px] text-sub font-[family-name:var(--font-geist-mono)] text-right">
                    {side.score !== null ? `${side.score.toFixed(0)}점` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-dim mt-3">
            {avgHrNote ? `${avgHrNote}. ` : ""}두 기준이 크게 다르면 심박이 평소와 다르게 반응한 날입니다.
          </p>
        </div>
      )}
    </div>
  );
}
