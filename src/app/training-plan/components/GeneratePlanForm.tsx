"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../theme";
import { MicroLabel } from "./atoms";

const TARGET_DISTANCES = ["", "5K", "10K", "HM", "FM"] as const;
// M11 Phase 1 (#222): 자주 사용하는 기간 프리셋. 정밀 조정은 우측 정수 입력.
const WEEK_COUNT_PRESETS = [4, 8, 12, 16] as const;
const WEEK_COUNT_MIN = 4;
const WEEK_COUNT_MAX = 24;

// M11 Phase 2 (#232): 목표 유형 옵션.
const GOAL_TYPES = [
  { value: "distance", label: "Distance", desc: "race 거리 기반 (기존)" },
  { value: "time", label: "Time", desc: "기록 목표 (페이스 개선)" },
  { value: "endurance", label: "Endurance", desc: "long run 최대 거리" },
] as const;
type GoalType = (typeof GOAL_TYPES)[number]["value"];
const TIME_GOAL_DISTANCES = ["5K", "10K", "HM", "FM"] as const;

interface Props {
  hasActivePlan: boolean;
}

/** "50:00" | "3:30:00" → 초. 파싱 실패 시 null. */
function parseTimeInput(txt: string): number | null {
  const parts = txt.trim().split(":").map((s) => Number.parseInt(s, 10));
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 1) return parts[0]; // 순수 초
  if (parts.length === 2) return parts[0] * 60 + parts[1]; // m:s
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]; // h:m:s
  return null;
}

export default function GeneratePlanForm({ hasActivePlan }: Props) {
  const router = useRouter();
  const [freq, setFreq] = useState<3 | 4 | 5>(4);
  // M11 Phase 1: 편집 중 clamp 는 UX 훼손 (예: "20" 타이핑 시 "2" → clamp 4 → append "0" → 40 → clamp 24).
  // 편집 중에는 raw 문자열을 유지, submit / blur 시점에만 정규화.
  const [weekCount, setWeekCount] = useState<number>(4);
  const [weekCountText, setWeekCountText] = useState<string>("4");

  // M11 Phase 2: goalType + 유형별 파라미터 state.
  const [goalType, setGoalType] = useState<GoalType>("distance");
  // distance 유형 (기존 필드)
  const [distance, setDistance] = useState<string>("");
  const [date, setDate] = useState<string>("");
  // time 유형
  const [timeDistance, setTimeDistance] = useState<string>("10K");
  const [timeTargetText, setTimeTargetText] = useState<string>(""); // "50:00" 형식
  const [timeDate, setTimeDate] = useState<string>("");
  // endurance 유형
  const [enduranceKmText, setEnduranceKmText] = useState<string>("");
  const [enduranceDate, setEnduranceDate] = useState<string>("");

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
    // Submit 시점에도 weekCountText 를 최종 정규화 (blur 가 안 났을 수도 있음).
    const parsedWc = Number.parseInt(weekCountText, 10);
    const effectiveWeekCount = Number.isFinite(parsedWc)
      ? Math.max(WEEK_COUNT_MIN, Math.min(WEEK_COUNT_MAX, parsedWc))
      : weekCount;
    if (effectiveWeekCount !== weekCount) {
      setWeekCount(effectiveWeekCount);
      setWeekCountText(String(effectiveWeekCount));
    }
    const payload: Record<string, unknown> = {
      weeklyFrequency: freq,
      weekCount: effectiveWeekCount,
      goalType,
    };
    if (goalType === "distance") {
      if (distance) payload.targetDistance = distance;
      if (distance && date) payload.targetDate = date;
    } else if (goalType === "time") {
      const targetSec = parseTimeInput(timeTargetText);
      if (targetSec === null || targetSec <= 0) {
        setError("time 목표 targetTime 을 '분:초' 또는 '시:분:초' 형식으로 입력하세요.");
        setSubmitting(false);
        return;
      }
      if (!timeDate) {
        setError("time 목표 race 예정일을 지정하세요.");
        setSubmitting(false);
        return;
      }
      payload.timeGoal = {
        distance: timeDistance,
        targetTimeSec: targetSec,
        targetDate: timeDate,
      };
    } else {
      const km = Number.parseFloat(enduranceKmText);
      if (!Number.isFinite(km) || km <= 0) {
        setError("endurance 목표 targetLongRunKm 을 숫자 (예: 25) 로 입력하세요.");
        setSubmitting(false);
        return;
      }
      const enduranceGoal: Record<string, unknown> = { targetLongRunKm: km };
      if (enduranceDate) enduranceGoal.targetDate = enduranceDate;
      payload.enduranceGoal = enduranceGoal;
    }
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

        {/* Duration (M11 Phase 1: weekCount 4~24) */}
        <div>
          <MicroLabel color={C.mid} className="mb-4">
            Plan duration
          </MicroLabel>
          <div className="flex flex-wrap items-stretch gap-2 md:gap-3 mt-5">
            {WEEK_COUNT_PRESETS.map((wc) => (
              <button
                key={wc}
                type="button"
                onClick={() => {
                  setWeekCount(wc);
                  setWeekCountText(String(wc));
                }}
                className="flex-1 min-w-[72px] py-3 transition-colors"
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 22,
                  fontWeight: 800,
                  border: `1px solid ${weekCount === wc ? C.primary : C.border}`,
                  background: weekCount === wc ? `${C.primary}11` : "transparent",
                  color: weekCount === wc ? C.primary : C.mid,
                  cursor: "pointer",
                }}
              >
                {wc}
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
                  weeks
                </span>
              </button>
            ))}
            <div className="flex items-center gap-2 min-w-[120px]">
              <input
                type="number"
                min={WEEK_COUNT_MIN}
                max={WEEK_COUNT_MAX}
                step={1}
                value={weekCountText}
                onChange={(e) => {
                  const raw = e.target.value;
                  setWeekCountText(raw);
                  const n = Number.parseInt(raw, 10);
                  if (
                    Number.isFinite(n) &&
                    n >= WEEK_COUNT_MIN &&
                    n <= WEEK_COUNT_MAX
                  ) {
                    setWeekCount(n);
                  }
                }}
                onBlur={() => {
                  const n = Number.parseInt(weekCountText, 10);
                  const clamped = Number.isFinite(n)
                    ? Math.max(WEEK_COUNT_MIN, Math.min(WEEK_COUNT_MAX, n))
                    : weekCount;
                  setWeekCount(clamped);
                  setWeekCountText(String(clamped));
                }}
                aria-label="플랜 기간(주)"
                className="w-full px-3 py-2"
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.hi,
                  fontFamily: FONT_MONO,
                  fontSize: 15,
                  textAlign: "center",
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontFamily: FONT_BODY,
                  fontWeight: 500,
                  color: C.lo,
                }}
              >
                4~24
              </span>
            </div>
          </div>
        </div>

        {/* M11 Phase 2: Goal type selector */}
        <div>
          <MicroLabel color={C.mid} className="mb-4">
            Goal type
          </MicroLabel>
          <div className="flex flex-wrap gap-2 md:gap-3 mt-5">
            {GOAL_TYPES.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGoalType(g.value)}
                className="flex-1 min-w-[120px] py-3 px-3 transition-colors text-left"
                style={{
                  fontFamily: FONT_BODY,
                  border: `1px solid ${goalType === g.value ? C.primary : C.border}`,
                  background: goalType === g.value ? `${C.primary}11` : "transparent",
                  color: goalType === g.value ? C.primary : C.mid,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>{g.label}</div>
                <div
                  style={{
                    fontSize: 10,
                    marginTop: 4,
                    color: C.lo,
                    fontWeight: 500,
                  }}
                >
                  {g.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Distance goal (기존) */}
        {goalType === "distance" && (
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
              마지막 주 창 내여야 taper 적용 (내일부터 {weekCount}주 중 최종 7일)
            </div>
          </div>
        </div>
        )}

        {/* Time goal */}
        {goalType === "time" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <MicroLabel color={C.mid} className="mb-3">
                Race distance
              </MicroLabel>
              <div className="flex gap-2 mt-4">
                {TIME_GOAL_DISTANCES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setTimeDistance(d)}
                    className="flex-1 py-2 transition-colors"
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      fontWeight: 600,
                      border: `1px solid ${timeDistance === d ? C.primary : C.border}`,
                      background: timeDistance === d ? `${C.primary}11` : "transparent",
                      color: timeDistance === d ? C.primary : C.mid,
                      cursor: "pointer",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <MicroLabel color={C.mid} className="mb-3">
                Target time
              </MicroLabel>
              <input
                type="text"
                value={timeTargetText}
                onChange={(e) => setTimeTargetText(e.target.value)}
                placeholder="예: 50:00 (m:s) 또는 3:45:00 (h:m:s)"
                aria-label="목표 기록"
                className="w-full mt-4 px-4 py-3"
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
              <MicroLabel color={C.mid} className="mb-3">
                Race date
              </MicroLabel>
              <input
                type="date"
                value={timeDate}
                onChange={(e) => setTimeDate(e.target.value)}
                className="w-full mt-4 px-4 py-3"
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.hi,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
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
                마지막 주 창 내여야 taper 적용
              </div>
            </div>
          </div>
        )}

        {/* Endurance goal */}
        {goalType === "endurance" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <MicroLabel color={C.mid} className="mb-3">
                Target long run
              </MicroLabel>
              <div className="flex items-center gap-2 mt-4">
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={0.5}
                  value={enduranceKmText}
                  onChange={(e) => setEnduranceKmText(e.target.value)}
                  placeholder="예: 25"
                  aria-label="목표 long run 거리 (km)"
                  className="w-full px-4 py-3"
                  style={{
                    background: "transparent",
                    border: `1px solid ${C.border}`,
                    color: C.hi,
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                  }}
                />
                <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.lo }}>
                  km
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: C.lo,
                  marginTop: 10,
                  fontFamily: FONT_BODY,
                  fontWeight: 500,
                }}
              >
                peak 주까지 도달할 long run 최대 거리 (1~50 km)
              </div>
            </div>
            <div>
              <MicroLabel color={C.mid} className="mb-3">
                Target date (선택)
              </MicroLabel>
              <input
                type="date"
                value={enduranceDate}
                onChange={(e) => setEnduranceDate(e.target.value)}
                className="w-full mt-4 px-4 py-3"
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.hi,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
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
                race 지정 시 마지막 주 창 내여야 함 (선택)
              </div>
            </div>
          </div>
        )}

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
