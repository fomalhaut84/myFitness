"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { C, ZONE_COLOR, TYPE_LABEL_KO, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../theme";
import type { ActivePlanWorkout } from "../types";
import type { WorkoutType } from "../theme";
import { parsePace } from "@/lib/training/workout-editor";
import { MicroLabel } from "./atoms";

interface Props {
  planId: string;
  workout: ActivePlanWorkout;
  onClose: () => void;
}

const TYPES: WorkoutType[] = ["easy", "long", "tempo", "interval", "recovery", "rest"];
const ZONES = ["Z1", "Z2", "Z3-4", "Z5"] as const;

export default function WorkoutEditModal({ planId, workout, onClose }: Props) {
  const router = useRouter();
  const [type, setType] = useState<WorkoutType>(workout.type);
  const [distanceKm, setDistanceKm] = useState<string>(
    workout.distanceKm !== null ? String(workout.distanceKm) : ""
  );
  const [pace, setPace] = useState<string>(workout.pace ?? "");
  const [zone, setZone] = useState<string>(workout.zone ?? "");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isRest = type === "rest";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || isPending) return;
    setError(null);
    setBusy(true);
    const body: Record<string, unknown> = { type };
    if (!isRest) {
      const dNum = distanceKm.trim() === "" ? null : parseFloat(distanceKm);
      if (dNum !== null && (isNaN(dNum) || dNum < 0)) {
        setError("distance 는 0 이상이어야 합니다.");
        setBusy(false);
        return;
      }
      body.distanceKm = dNum;
      // pace 클라이언트 즉시 검증 (서버 왕복 없이 UX 개선).
      const paceTrim = pace.trim();
      if (paceTrim !== "") {
        if (parsePace(paceTrim) === null) {
          setError("pace 형식은 m:ss (예: 5:30, 초는 0~59) 이며 2:00~15:00/km 범위여야 합니다.");
          setBusy(false);
          return;
        }
      }
      body.pace = paceTrim === "" ? null : paceTrim;
      body.zone = zone === "" ? null : zone;
    }
    if (notes.trim() !== "") body.notes = notes.trim();
    try {
      const res = await fetch(
        `/api/training-plan/${planId}/workouts/${workout.date}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? `요청 실패 (${res.status})`);
        setBusy(false);
        return;
      }
      startTransition(() => {
        router.refresh();
        onClose();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleReset() {
    if (busy || isPending) return;
    if (!confirm("이 workout 을 휴식으로 되돌립니다. 계속?")) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/training-plan/${planId}/workouts/${workout.date}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "rest" }),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? `요청 실패 (${res.status})`);
        setBusy(false);
        return;
      }
      startTransition(() => {
        router.refresh();
        onClose();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6"
      style={{ background: "#00000099", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full md:max-w-md p-6 md:p-8 md:rounded-sm"
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          fontFamily: FONT_BODY,
        }}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <MicroLabel color={C.mid}>Edit · {workout.date}</MicroLabel>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 24,
                fontWeight: 700,
                color: C.hi,
                letterSpacing: "-0.01em",
                marginTop: 4,
              }}
            >
              워크아웃 편집
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              background: "transparent",
              border: "none",
              color: C.mid,
              cursor: "pointer",
              fontSize: 24,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Type */}
        <div className="mb-5">
          <MicroLabel color={C.mid} className="mb-3">
            Type
          </MicroLabel>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                disabled={disabled}
                className="py-2.5 transition-colors"
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  border: `1px solid ${type === t ? C.primary : C.border}`,
                  background: type === t ? `${C.primary}11` : "transparent",
                  color: type === t ? C.primary : C.mid,
                  cursor: disabled ? "wait" : "pointer",
                }}
              >
                {TYPE_LABEL_KO[t]}
              </button>
            ))}
          </div>
        </div>

        {!isRest && (
          <>
            {/* Distance + pace */}
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <MicroLabel color={C.mid} className="mb-2">
                  Distance (km)
                </MicroLabel>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(e.target.value)}
                  disabled={disabled}
                  className="w-full mt-3 px-3 py-2"
                  style={{
                    background: "transparent",
                    border: `1px solid ${C.border}`,
                    color: C.hi,
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                  }}
                />
              </div>
              <div>
                <MicroLabel color={C.mid} className="mb-2">
                  Pace (m:ss)
                </MicroLabel>
                <input
                  type="text"
                  value={pace}
                  onChange={(e) => setPace(e.target.value)}
                  disabled={disabled}
                  placeholder="5:30"
                  className="w-full mt-3 px-3 py-2"
                  style={{
                    background: "transparent",
                    border: `1px solid ${C.border}`,
                    color: C.hi,
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                  }}
                />
              </div>
            </div>

            {/* Zone */}
            <div className="mb-5">
              <MicroLabel color={C.mid} className="mb-2">
                Zone
              </MicroLabel>
              <div className="grid grid-cols-4 gap-2 mt-3">
                {ZONES.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZone(z)}
                    disabled={disabled}
                    className="py-2 transition-colors"
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      fontWeight: 600,
                      border: `1px solid ${zone === z ? ZONE_COLOR[z] : C.border}`,
                      background:
                        zone === z ? `${ZONE_COLOR[z]}14` : "transparent",
                      color: zone === z ? ZONE_COLOR[z] : C.mid,
                      cursor: disabled ? "wait" : "pointer",
                    }}
                  >
                    {z}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Notes */}
        <div className="mb-6">
          <MicroLabel color={C.mid} className="mb-2">
            Notes
          </MicroLabel>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
            placeholder="추가 메모"
            className="w-full mt-3 px-3 py-2"
            style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.hi,
              fontFamily: FONT_BODY,
              fontSize: 13,
            }}
          />
        </div>

        {error && (
          <div
            className="mb-5 p-3"
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

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={disabled}
            className="px-4 py-2.5"
            style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              color: C.mid,
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: disabled ? "wait" : "pointer",
            }}
          >
            휴식으로 되돌리기
          </button>
          <button
            type="submit"
            disabled={disabled}
            className="px-6 py-2.5"
            style={{
              background: C.primary,
              color: "#fff",
              fontFamily: FONT_DISPLAY,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              border: "none",
              cursor: disabled ? "wait" : "pointer",
              opacity: disabled ? 0.7 : 1,
            }}
          >
            {disabled ? "저장 중" : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
