"use client";

// #544: 복용 중 카드 — 장기는 "N년 N개월째" + 복용 종료 (오늘), 진행 중 단기는 점선 + "N일 남음".
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MedicationDto } from "@/lib/medication/dto";
import { daysLeft, sinceText } from "@/lib/medication/period";
import { PILL, medPillClass, medPillText } from "./med-style";

interface ActiveMedCardProps {
  med: MedicationDto;
  today: string;
  /** 관련 검진 항목 표시 이름 */
  related: string[];
}

export default function ActiveMedCard({ med, today, related }: ActiveMedCardProps) {
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = med.regimen === "short_term";

  async function end() {
    setEnding(true);
    setError(null);
    try {
      const res = await fetch(`/api/medications/${med.id}/end`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `저장하지 못했습니다 (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다");
      setEnding(false);
    }
  }

  const meta = [med.dose, med.frequency, med.prescriber].filter(Boolean).join(" · ");
  return (
    <article className={`grid gap-1.5 rounded-xl border bg-card px-3.5 py-3 ${short ? "border-dashed border-border-hover" : "border-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-bright">{med.name}</h3>
        <span className={`${PILL} ${medPillClass(med)}`}>{medPillText(med)}</span>
      </div>
      {meta && <p className="text-xs text-sub">{meta}</p>}
      <p className="font-[family-name:var(--font-geist-mono)] text-xs text-muted">
        {short && med.endDate
          ? `${med.startDate} ~ ${med.endDate} · ${daysLeft(med.endDate, today) === 0 ? "오늘까지" : `${daysLeft(med.endDate, today)}일 남음`}`
          : `${med.startDate} 부터${med.endDate ? ` ~ ${med.endDate}` : ""} · ${sinceText(med.startDate, today)}`}
      </p>
      {related.length > 0 && (
        <p className="flex flex-wrap gap-1">
          {related.map((r) => (
            <span key={r} className="rounded border border-border px-1.5 text-[11px] text-sub">
              {r}
            </span>
          ))}
        </p>
      )}
      <div className="mt-0.5 flex flex-wrap gap-1.5">
        {!short && (
          <button
            type="button"
            disabled={ending}
            onClick={end}
            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs hover:border-border-hover disabled:opacity-50"
          >
            {ending ? "저장 중…" : "복용 종료 (오늘)"}
          </button>
        )}
        <Link href={`/medical/meds/${med.id}/edit`} className="rounded-lg px-2.5 py-1 text-xs text-sub hover:text-bright">
          수정
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </article>
  );
}
