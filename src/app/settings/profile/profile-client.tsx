"use client";

import { useState } from "react";

interface ProfileValues {
  name: string;
  birthDate: string; // "YYYY-MM-DD" or ""
  height: number | null;
  targetWeight: number | null;
  restingHRBase: number | null;
  maxHR: number | null;
  lthr: number | null;
  lthrPace: number | null; // sec/km
  targetCalories: number | null;
}

interface ProfileClientProps {
  initial: ProfileValues;
}

/** "M:SS" → sec */
function parsePace(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^(\d+):(\d{1,2})$/.exec(trimmed);
  if (!match) return null;
  const min = Number(match[1]);
  const sec = Number(match[2]);
  if (sec >= 60) return null;
  return min * 60 + sec;
}

/** sec → "M:SS" */
function formatPace(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return "";
  const min = Math.floor(sec / 60);
  const s = Math.round(sec - min * 60);
  return `${min}:${String(s).padStart(2, "0")}`;
}

function toNumOrNull(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export default function ProfileClient({ initial }: ProfileClientProps) {
  const [values, setValues] = useState(() => ({
    name: initial.name,
    birthDate: initial.birthDate,
    height: initial.height === null ? "" : String(initial.height),
    targetWeight:
      initial.targetWeight === null ? "" : String(initial.targetWeight),
    restingHRBase:
      initial.restingHRBase === null ? "" : String(initial.restingHRBase),
    maxHR: initial.maxHR === null ? "" : String(initial.maxHR),
    lthr: initial.lthr === null ? "" : String(initial.lthr),
    lthrPace: formatPace(initial.lthrPace),
    targetCalories:
      initial.targetCalories === null ? "" : String(initial.targetCalories),
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function setField<K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K]
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const pace = values.lthrPace ? parsePace(values.lthrPace) : null;
    if (values.lthrPace && pace === null) {
      setMessage({ type: "error", text: "LTHR 페이스는 M:SS 형식이어야 합니다" });
      return;
    }

    const payload = {
      name: values.name.trim() || "사용자",
      birthDate: values.birthDate || null,
      height: toNumOrNull(values.height),
      targetWeight: toNumOrNull(values.targetWeight),
      restingHRBase: toNumOrNull(values.restingHRBase),
      maxHR: toNumOrNull(values.maxHR),
      lthr: toNumOrNull(values.lthr),
      lthrPace: pace,
      targetCalories: toNumOrNull(values.targetCalories),
    };

    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({
          type: "error",
          text: data?.error ?? "저장 실패",
        });
        return;
      }
      setMessage({ type: "success", text: "저장되었습니다" });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "네트워크 오류",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">프로필 설정</h1>
        <p className="text-dim text-sm">
          개인 심박 Zone, 칼로리 목표 등을 관리합니다
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* 기본 정보 */}
        <section className="space-y-4">
          <h2 className="text-sm text-muted uppercase tracking-wider">
            기본 정보
          </h2>

          <Field label="이름">
            <input
              type="text"
              value={values.name}
              onChange={(e) => setField("name", e.target.value)}
              className={INPUT_CLASS}
              maxLength={100}
            />
          </Field>

          <Field label="생년월일">
            <input
              type="date"
              value={values.birthDate}
              onChange={(e) => setField("birthDate", e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="키 (cm)">
              <input
                type="number"
                step="0.1"
                value={values.height}
                onChange={(e) => setField("height", e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="목표 체중 (kg)">
              <input
                type="number"
                step="0.1"
                value={values.targetWeight}
                onChange={(e) => setField("targetWeight", e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </section>

        {/* 심박 Zone */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm text-muted uppercase tracking-wider">
              심박 Zone
            </h2>
            <p className="text-xs text-dim mt-1">
              실측값을 입력하면 러닝 분석·AI 리포트가 개인화됩니다
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="최대 심박 (bpm)"
              hint="최대 노력 런 마지막 1분 평균 또는 Garmin 최고 기록"
            >
              <input
                type="number"
                value={values.maxHR}
                onChange={(e) => setField("maxHR", e.target.value)}
                className={INPUT_CLASS}
                min={100}
                max={230}
              />
            </Field>
            <Field
              label="안정시 심박 (bpm)"
              hint="아침 기상 직후 측정한 안정시 심박 기준값"
            >
              <input
                type="number"
                value={values.restingHRBase}
                onChange={(e) => setField("restingHRBase", e.target.value)}
                className={INPUT_CLASS}
                min={20}
                max={150}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="LTHR (bpm)"
              hint="20분 TT 평균 심박 × 0.95 또는 Garmin 트레이닝 스테이터스"
            >
              <input
                type="number"
                value={values.lthr}
                onChange={(e) => setField("lthr", e.target.value)}
                className={INPUT_CLASS}
                min={60}
                max={220}
              />
            </Field>
            <Field label="LTHR 페이스 (M:SS /km)">
              <input
                type="text"
                placeholder="5:21"
                value={values.lthrPace}
                onChange={(e) => setField("lthrPace", e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </section>

        {/* 칼로리 목표 */}
        <section className="space-y-4">
          <h2 className="text-sm text-muted uppercase tracking-wider">
            칼로리 목표
          </h2>

          <Field
            label="일일 칼로리 목표 (kcal)"
            hint="체중감량 목표에 맞는 기본 섭취 칼로리. 활성 칼로리와 합산하여 섭취가능 칼로리 계산"
          >
            <input
              type="number"
              value={values.targetCalories}
              onChange={(e) => setField("targetCalories", e.target.value)}
              className={INPUT_CLASS}
              min={500}
              max={8000}
            />
          </Field>
        </section>

        {/* 저장 영역 */}
        <div className="flex items-center gap-3 pt-4 border-t border-[#1e1e1e]">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-md bg-accent text-black text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
          {message && (
            <span
              className={`text-sm ${
                message.type === "success" ? "text-accent" : "text-red-400"
              }`}
              role="status"
            >
              {message.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-md bg-card border border-[#1e1e1e] text-bright text-sm focus:outline-none focus:border-accent/60 transition-colors";

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="block">
      <div className="text-xs text-sub mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-dim mt-1">{hint}</div>}
    </label>
  );
}
