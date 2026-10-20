"use client";

// #570: 강도 평가 기준 (심박 / 파워 / 자동) — 저장된 강도 값은 그대로, 읽는 기준만 바뀐다 (스펙 §2-1 · §2-2)
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IntensityBasisSetting } from "@/lib/fitness/intensity";
import { HEAT_APPARENT_TEMP_C } from "@/lib/fitness/intensity-select";

const OPTIONS: { value: IntensityBasisSetting; name: string; description: string }[] = [
  { value: "hr", name: "심박", description: "모든 활동을 심박 존 (LTHR 기준) 으로 잽니다." },
  {
    value: "power",
    name: "파워",
    description: "러닝 파워 기록이 있으면 파워로, 없는 활동 (러닝 외 · 파워 없는 러닝) 은 심박으로 잽니다.",
  },
  {
    value: "auto",
    name: "자동",
    description: `평소엔 심박으로 잽니다. 심박에 영향을 주는 약을 먹는 기간이나 체감 ${HEAT_APPARENT_TEMP_C}°C 이상인 날의 러닝만 파워로 잽니다.`,
  },
];

/** 조사까지 — "파워로" · "심박으로" */
const TO_NAME: Record<IntensityBasisSetting, string> = { hr: "심박으로", power: "파워로", auto: "자동으로" };

export default function IntensityBasisSection({
  current,
  hasThresholdPower,
  hrAffectingMedCount,
}: {
  current: IntensityBasisSetting;
  hasThresholdPower: boolean;
  /** "심박에 영향" 표시된 복약 수 — 자동 기준 안내용 */
  hrAffectingMedCount: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<IntensityBasisSetting>(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleApply() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intensityBasis: selected }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "저장 실패");
      }
      setMessage({ type: "success", text: `기준을 ${TO_NAME[selected]} 바꿨습니다. 지난 활동도 이 기준으로 보입니다.` });
      router.refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "네트워크 오류" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl p-5 mb-6 space-y-4" aria-labelledby="intensity-basis-h">
      <div>
        <h2 id="intensity-basis-h" className="text-[15px] font-semibold text-bright">강도 평가 기준</h2>
        <p className="text-[12px] text-sub mt-0.5">
          활동의 강도 라벨 · 존 분포 · 훈련 부하를 무엇으로 잴지 고릅니다. AI 리포트와 운동 평가도 이 기준을 따릅니다.
        </p>
      </div>

      <div role="radiogroup" aria-label="강도 평가 기준" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {OPTIONS.map((o) => {
          const on = selected === o.value;
          return (
            <label
              key={o.value}
              className={`block rounded-lg border px-3 py-2.5 cursor-pointer transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-accent ${
                on ? "border-accent bg-accent/10" : "border-[#1e1e1e] bg-surface hover:border-[#333]"
              }`}
            >
              <input
                type="radio"
                name="intensityBasis"
                value={o.value}
                checked={on}
                onChange={() => setSelected(o.value)}
                className="sr-only"
              />
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-bright">{o.name}</span>
                {current === o.value && <span className="text-[10px] text-accent">사용 중</span>}
              </span>
              <span className="block text-[12px] text-sub mt-0.5 leading-snug">{o.description}</span>
            </label>
          );
        })}
      </div>

      <p className="border-l-2 border-[#333] pl-3 py-1 text-[12px] text-sub">
        기록은 심박 · 파워 두 가지로 모두 저장돼 있어 바뀌지 않습니다. 활동 강도 · 훈련 부하 · 부상 위험 (ACWR) · AI
        리포트가 읽는 기준만 바뀌고, 언제든 되돌릴 수 있습니다.
      </p>
      {selected !== "hr" && !hasThresholdPower && (
        <p className="border-l-2 border-amber-500/60 pl-3 py-1 text-[12px] text-amber-300">
          역치파워가 아직 없어 지난 러닝의 파워 기준 값을 채우지 못했습니다. 그동안은 심박으로 보입니다. 러닝 파워
          카드에서 값을 넣거나 다음 싱크 (06:00) 를 기다리세요.
        </p>
      )}
      {selected === "auto" && hrAffectingMedCount === 0 && (
        <p className="text-[12px] text-dim">
          &quot;심박에 영향을 주는 약&quot; 으로 표시된 복약이 없습니다. 지금은 더운 날의 러닝만 파워로 잽니다 (복약 기록에서 표시).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleApply}
          disabled={busy || selected === current}
          className="px-4 py-2 rounded-md bg-accent text-black text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "바꾸는 중..." : `${TO_NAME[selected]} 바꾸기`}
        </button>
        {selected !== current && (
          <button
            type="button"
            onClick={() => setSelected(current)}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-surface border border-[#2a2a2a] text-sm"
          >
            취소
          </button>
        )}
        {message && (
          <span className={`text-sm ${message.type === "success" ? "text-accent" : "text-red-400"}`} role="status">
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
