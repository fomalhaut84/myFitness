"use client";

// #299: 근손실 위험 배너. high/medium/low 팔레트 전환. 접기 가능.

import { useState } from "react";
import type { MuscleLossVerdict } from "@/lib/fitness/muscle-loss-risk";

interface Props {
  verdict: MuscleLossVerdict;
}

const PALETTE = {
  high: {
    dot: "#dc2626",
    label: "HIGH",
    labelClr: "#fca5a5",
    borderClr: "rgba(220,38,38,.28)",
    ring: "shadow-[0_0_0_1px_rgba(220,38,38,.18),0_12px_40px_-12px_rgba(220,38,38,.28)]",
    diag: "before:content-[''] before:absolute before:inset-0 before:pointer-events-none before:bg-[repeating-linear-gradient(45deg,transparent_0,transparent_8px,rgba(220,38,38,.05)_8px,rgba(220,38,38,.05)_9px)]",
  },
  medium: {
    dot: "#f59e0b",
    label: "MEDIUM",
    labelClr: "#fcd34d",
    borderClr: "rgba(245,158,11,.25)",
    ring: "shadow-[0_0_0_1px_rgba(245,158,11,.16),0_12px_40px_-12px_rgba(245,158,11,.22)]",
    diag: "",
  },
  low: {
    dot: "#34d399",
    label: "LOW",
    labelClr: "#6ee7b7",
    borderClr: "rgba(52,211,153,.22)",
    ring: "",
    diag: "",
  },
} as const;

export default function MuscleLossBanner({ verdict }: Props) {
  const palette = PALETTE[verdict.risk];
  const [open, setOpen] = useState(verdict.risk !== "low");

  if (verdict.risk === "low") {
    return (
      <div className="px-4 py-3 rounded-xl flex items-center gap-3 bg-card" style={{ border: `1px solid ${palette.borderClr}` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.dot }}></span>
        <div className="flex-1 text-[13px]">
          <span className="font-medium" style={{ color: palette.labelClr }}>근손실 위험 LOW</span>
          <span className="text-dim ml-2">단백질·결손·고강도 지표 모두 안전 범위</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`relative rounded-xl overflow-hidden bg-card ${palette.diag} ${palette.ring}`} style={{ border: `1px solid ${palette.borderClr}` }}>
      <button onClick={() => setOpen(!open)} className="relative w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="w-2 h-2 rounded-full" style={{ background: palette.dot }}></span>
        <div className="flex-1">
          <div className="text-[11px] tracking-[0.22em] uppercase font-[family-name:var(--font-geist-mono)] text-dim">근손실 위험</div>
          <div className="text-[18px] font-semibold mt-0.5 tracking-tight" style={{ color: palette.labelClr }}>
            {palette.label}
            <span className="font-[family-name:var(--font-geist-mono)] text-[13px] ml-2 font-normal text-dim">score {verdict.score}/3</span>
          </div>
        </div>
        <span className="text-xs font-[family-name:var(--font-geist-mono)] text-dim">{open ? "접기" : "펼치기"}</span>
      </button>
      {open && (
        <div className="relative px-4 pb-4">
          <div className="grid grid-cols-1 gap-1.5 mb-4">
            {verdict.reasons.map((r, i) => (
              <div key={i} className="text-[13px] text-muted flex items-start gap-2">
                <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-dim mt-0.5">0{i+1}</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
          {verdict.recommendations.length > 0 && (
            <div className="border-t border-border/60 pt-3">
              <div className="text-[10px] tracking-[0.2em] uppercase text-dim font-[family-name:var(--font-geist-mono)] mb-2">권장</div>
              <ul className="space-y-1.5">
                {verdict.recommendations.map((r, i) => (
                  <li key={i} className="text-[13px] text-bright before:content-['▸'] before:text-dim before:mr-2">{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
