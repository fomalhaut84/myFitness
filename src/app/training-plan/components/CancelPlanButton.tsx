"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { C, FONT_BODY, FONT_DISPLAY } from "../theme";
import { MicroLabel } from "./atoms";

interface Props {
  planId: string;
}

export default function CancelPlanButton({ planId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleClick() {
    if (busy || isPending) return;
    if (
      !confirm(
        "이 트레이닝 플랜을 취소합니다. 취소 시 archived 로 이동하며 되돌릴 수 없습니다. 계속?"
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/training-plan/${planId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? `요청 실패 (${res.status})`);
        setBusy(false);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <div className="mt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6" style={{ border: `1px solid ${C.border}`, background: C.panel }}>
      <div>
        <MicroLabel color={C.mid}>Cancel</MicroLabel>
        <div
          className="mt-2"
          style={{
            fontFamily: FONT_BODY,
            fontSize: 13,
            color: C.mid,
            fontWeight: 500,
            lineHeight: 1.5,
          }}
        >
          현재 활성 플랜을 아카이빙합니다. 새 플랜 생성 없이 그대로 종료.
        </div>
        {error && (
          <div
            className="mt-2"
            style={{
              fontFamily: FONT_BODY,
              fontSize: 12,
              color: C.missed,
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="px-6 py-3 self-start md:self-auto shrink-0"
        style={{
          background: "transparent",
          border: `1px solid ${C.missed}66`,
          color: C.missed,
          fontFamily: FONT_DISPLAY,
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          cursor: disabled ? "wait" : "pointer",
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {disabled ? "처리 중" : "플랜 취소"}
      </button>
    </div>
  );
}
