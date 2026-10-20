"use client";

// #570: 프로필 러닝 파워 카드 — 역치파워 (Garmin 자동 / 수동) · 존 자 · 수동 입력 · Garmin 자동으로 되돌리기
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  POWER_ZONE_COLORS,
  POWER_ZONE_FLOOR_RATIOS,
  THRESHOLD_POWER_MAX,
  THRESHOLD_POWER_MIN,
  getPowerZoneRanges,
  type PowerZoneRange,
} from "@/lib/fitness/power-zones";

export interface RunningPowerMeta {
  thresholdPower: number | null;
  source: string | null;
  autoDetected: boolean | null;
  /** ISO — 감지 · 변경 시각 */
  measuredAt: string | null;
  /** 최근 싱크의 Garmin 역치파워 (수동 보호 중이어도 비교용) */
  garminThresholdPower: number | null;
  zones: PowerZoneRange[] | null;
  zoneSource: "garmin" | "calculated" | null;
}

/** Z5 는 상한이 없어 막대 폭을 역치의 15% 로 둔다 */
const Z5_WIDTH_RATIO = 0.15;

function ZoneRuler({ zones, thresholdPower }: { zones: PowerZoneRange[]; thresholdPower: number }) {
  const widths = zones.map((z) => (z.max === null ? thresholdPower * Z5_WIDTH_RATIO : z.max + 1 - z.min));
  const cols = widths.map((w) => `${Math.max(w, 1)}fr`).join(" ");
  return (
    <div>
      <div className="grid h-7 rounded-md overflow-hidden" style={{ gridTemplateColumns: cols }}>
        {zones.map((z, i) => (
          <div
            key={z.zone}
            className="flex items-center pl-1.5 text-[11px] font-[family-name:var(--font-geist-mono)]"
            style={{ backgroundColor: POWER_ZONE_COLORS[i], color: i >= 3 ? "#fff" : "#0a0a0a" }}
            title={`Z${z.zone} ${z.label}`}
          >
            Z{z.zone}
          </div>
        ))}
      </div>
      <div
        className="grid text-[11px] text-sub font-[family-name:var(--font-geist-mono)]"
        style={{ gridTemplateColumns: cols }}
      >
        {zones.map((z, i) => (
          <span key={z.zone} className="border-l border-[#333] pl-1 pt-0.5">
            {z.min}
            {i === zones.length - 1 ? " W" : ""}
          </span>
        ))}
      </div>
      <p className="text-[12px] text-dim mt-2">
        {zones.map((z) => `Z${z.zone} ${z.label}`).join(" · ")} — 역치 대비{" "}
        {POWER_ZONE_FLOOR_RATIOS.map((r) => Math.round(r * 100)).join(" · ")}%. 심박 존보다 한 칸 위라 역치는 Z3 입니다.
      </p>
    </div>
  );
}

async function patchProfile(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "저장 실패");
  }
}

export default function RunningPowerSection({ meta }: { meta: RunningPowerMeta }) {
  const router = useRouter();
  const [input, setInput] = useState(meta.thresholdPower !== null ? String(meta.thresholdPower) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isManual = meta.source === "manual";
  const differs = isManual && meta.garminThresholdPower !== null && meta.garminThresholdPower !== meta.thresholdPower;
  const parsed = input.trim() === "" ? null : Number(input);
  const inputValid =
    parsed === null || (Number.isInteger(parsed) && parsed >= THRESHOLD_POWER_MIN && parsed <= THRESHOLD_POWER_MAX);
  const previewZ3 = parsed !== null && inputValid ? getPowerZoneRanges(parsed)[2] : null;

  async function run(task: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage({ type: "success", text: done });
      router.refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "네트워크 오류" });
    } finally {
      setBusy(false);
    }
  }

  function handleSave() {
    if (!inputValid) {
      setMessage({ type: "error", text: `역치파워는 ${THRESHOLD_POWER_MIN}~${THRESHOLD_POWER_MAX} W 정수로 입력하세요` });
      return;
    }
    void run(() => patchProfile({ thresholdPower: parsed }), parsed === null ? "역치파워를 비웠습니다" : "역치파워를 저장했습니다");
  }

  function handleRevert() {
    void run(() => patchProfile({ revertToGarmin: ["thresholdPower"] }), "Garmin 자동으로 바꿨습니다. 다음 싱크부터 Garmin 값을 씁니다");
  }

  return (
    <section className="bg-card border border-border rounded-xl p-5 mb-6 space-y-4" aria-labelledby="running-power-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="running-power-h" className="text-[15px] font-semibold text-bright">러닝 파워</h2>
        <span className="text-[12px] text-sub">Garmin 워치가 산출한 역치파워를 06:00 싱크로 가져옵니다</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="text-dim w-14">역치파워</span>
        {meta.source === "garmin" ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300">Garmin 자동</span>
        ) : meta.source === "manual" ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">수동</span>
        ) : (
          <span className="text-dim">미설정</span>
        )}
        {meta.thresholdPower !== null && (
          <span className="text-bright font-[family-name:var(--font-geist-mono)]">{meta.thresholdPower} W</span>
        )}
        {isManual && meta.garminThresholdPower !== null && (
          <span className={`font-[family-name:var(--font-geist-mono)] ${differs ? "text-amber-300" : "text-dim"}`}>
            · Garmin {meta.garminThresholdPower} W
          </span>
        )}
        {!isManual && meta.measuredAt && (
          <span className="text-dim">
            · {new Date(meta.measuredAt).toLocaleDateString("ko-KR")} {meta.autoDetected ? "자동 감지" : "변경"}
          </span>
        )}
        {isManual && (
          <button
            type="button"
            onClick={handleRevert}
            disabled={busy}
            className="ml-auto px-2 py-0.5 rounded border border-[#2a2a2a] text-[11px] hover:border-accent/60 disabled:opacity-50 transition-colors"
          >
            Garmin 자동으로
          </button>
        )}
      </div>

      {meta.zones && meta.thresholdPower !== null ? (
        <ZoneRuler zones={meta.zones} thresholdPower={meta.thresholdPower} />
      ) : (
        <p className="text-[12px] text-dim">
          역치파워가 아직 없습니다. 다음 싱크를 기다리거나 아래에 직접 넣으세요.
        </p>
      )}

      <div>
        <label htmlFor="threshold-power" className="block text-xs text-sub mb-1.5">역치파워 (W)</label>
        <div className="flex flex-wrap items-center gap-2">
            <input
              id="threshold-power"
              type="number"
              inputMode="numeric"
              min={THRESHOLD_POWER_MIN}
              max={THRESHOLD_POWER_MAX}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-40 px-3 py-2 rounded-md bg-surface border border-[#1e1e1e] text-bright text-sm font-[family-name:var(--font-geist-mono)] focus:outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || parsed === meta.thresholdPower}
              className="px-3 py-2 rounded-md bg-surface border border-[#2a2a2a] text-sm hover:border-accent/60 disabled:opacity-50 transition-colors"
            >
              {busy ? "저장 중..." : "저장"}
            </button>
        </div>
        <div className="text-[11px] text-dim mt-1">
          수동으로 넣으면 싱크가 덮어쓰지 않습니다. 존 경계는 역치 대비 비율로 계산합니다
          {previewZ3 && previewZ3.max !== null ? ` (Z3 역치 ${previewZ3.min}–${previewZ3.max} W)` : ""}.
        </div>
      </div>

      {message && (
        <div className={`text-[12px] ${message.type === "success" ? "text-accent" : "text-red-400"}`} role="status">
          {message.text}
        </div>
      )}
    </section>
  );
}
