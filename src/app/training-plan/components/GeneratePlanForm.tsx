"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../theme";
import { MicroLabel } from "./atoms";

const TARGET_DISTANCES = ["", "5K", "10K", "HM", "FM"] as const;

interface Props {
  hasActivePlan: boolean;
}

export default function GeneratePlanForm({ hasActivePlan }: Props) {
  const router = useRouter();
  const [freq, setFreq] = useState<3 | 4 | 5>(4);
  const [distance, setDistance] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  // submitting = POST 진행 중, isPending = router.refresh 진행 중.
  // POST 는 mutating (기존 active → archived + 신규 active) 이라 중복 호출 시
  // 첫 결과가 즉시 archived 되는 문제 → busy 상태 유지 필요.
  const busy = submitting || isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return; // guard: 이미 요청 진행 중.
    setError(null);
    setSubmitting(true);
    const payload: Record<string, unknown> = { weeklyFrequency: freq };
    if (distance) payload.targetDistance = distance;
    if (distance && date) payload.targetDate = date;
    try {
      const res = await fetch("/api/training-plan/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `요청 실패 (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 md:gap-12 p-6 md:p-12 lg:p-14"
      style={{ border: `1px solid ${C.border}`, background: C.panel }}
    >
      <div className="space-y-8 md:space-y-10">
        {/* Frequency */}
        <div>
          <MicroLabel color={C.mid} className="mb-4">
            Weekly frequency
          </MicroLabel>
          <div className="flex gap-2 md:gap-3 mt-5">
            {([3, 4, 5] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setFreq(n)}
                className="flex-1 py-4 transition-colors"
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 32,
                  fontWeight: 800,
                  border: `1px solid ${freq === n ? C.primary : C.border}`,
                  background: freq === n ? `${C.primary}11` : "transparent",
                  color: freq === n ? C.primary : C.mid,
                  cursor: "pointer",
                }}
              >
                {n}
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: FONT_BODY,
                    fontWeight: 500,
                    display: "block",
                    color: C.lo,
                    marginTop: 4,
                  }}
                >
                  runs/wk
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Target */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <MicroLabel color={C.mid} className="mb-3">
              Target distance
            </MicroLabel>
            <div className="flex gap-2 mt-4">
              {TARGET_DISTANCES.map((d, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setDistance(d);
                    if (!d) setDate("");
                  }}
                  className="flex-1 py-2 transition-colors"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 12,
                    fontWeight: 600,
                    border: `1px solid ${distance === d ? C.primary : C.border}`,
                    background: distance === d ? `${C.primary}11` : "transparent",
                    color: distance === d ? C.primary : C.mid,
                    cursor: "pointer",
                  }}
                >
                  {d || "—"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <MicroLabel color={C.mid} className="mb-3">
              Race date {distance ? "" : "(distance 선택 후)"}
            </MicroLabel>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!distance}
              className="w-full mt-4 px-4 py-3"
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.hi,
                fontFamily: FONT_MONO,
                fontSize: 13,
                opacity: distance ? 1 : 0.4,
              }}
            />
            <div
              style={{
                fontSize: 11,
                color: C.lo,
                marginTop: 10,
                fontFamily: FONT_BODY,
                fontWeight: 500,
              }}
            >
              Wk4 창 내여야 taper 적용 (오늘 +22~28일)
            </div>
          </div>
        </div>

        {error && (
          <div
            className="p-4"
            style={{
              border: `1px solid ${C.missed}66`,
              background: `${C.missed}11`,
              fontFamily: FONT_BODY,
              fontSize: 13,
              color: C.missed,
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-col justify-end gap-4 w-full lg:w-auto">
        {hasActivePlan && (
          <div
            className="p-4 w-full lg:max-w-[280px]"
            style={{
              border: `1px solid ${C.primary}44`,
              background: `${C.primary}0A`,
              fontFamily: FONT_BODY,
              fontSize: 12,
              color: C.mid,
              lineHeight: 1.6,
              fontWeight: 500,
            }}
          >
            <MicroLabel color={C.primary}>Warning</MicroLabel>
            <div className="mt-2">
              기존 active plan 이 archived 로 이동합니다. 되돌릴 수 없음.
            </div>
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full lg:w-auto px-8 md:px-10 py-4 md:py-5 transition-colors"
          style={{
            background: C.primary,
            color: "#fff",
            fontFamily: FONT_DISPLAY,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            border: "none",
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Generating..." : "Generate plan →"}
        </button>
      </div>
    </form>
  );
}
