"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProfileValues {
  name: string;
  birthDate: string; // "YYYY-MM-DD" or ""
  height: number | null;
  targetWeight: number | null;
  targetDate: string; // "YYYY-MM-DD" or ""
  restingHRBase: number | null;
  maxHR: number | null;
  lthr: number | null;
  lthrPace: number | null; // sec/km
  targetCalories: number | null;
}

interface GarminMeta {
  maxHRSource: string | null;
  lthrSource: string | null;
  lthrAutoDetected: boolean | null;
  vo2maxRunning: number | null;
  garminSyncedAt: string | null;
}

interface MetricChangeEntry {
  id: string;
  field: string;
  oldValue: number | null;
  newValue: number | null;
  source: string;
  reason: string | null;
  changedAt: string;
}

interface ProfileClientProps {
  initial: ProfileValues;
  garminMeta?: GarminMeta;
  metricHistory?: MetricChangeEntry[];
}

const FIELD_LABELS: Record<string, string> = {
  maxHR: "최대 심박",
  lthr: "LTHR",
  lthrPace: "LTHR 페이스",
  vo2maxRunning: "VO2max",
  restingHRBase: "안정시 심박",
};

const FIELD_UNITS: Record<string, string> = {
  maxHR: "bpm",
  lthr: "bpm",
  lthrPace: "sec/km",
  vo2maxRunning: "",
  restingHRBase: "bpm",
};

const REASON_LABELS: Record<string, string> = {
  user_edit: "수동 편집",
  garmin_initial: "Garmin 초기 싱크",
  garmin_auto_detect: "Garmin 자동 감지",
  garmin_change_state: "Garmin 변경 알림",
};

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

/** sec → "M:SS" (반올림으로 60초 발생 방지) */
function formatPace(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return "";
  const total = Math.round(sec);
  const min = Math.floor(total / 60);
  const s = total % 60;
  return `${min}:${String(s).padStart(2, "0")}`;
}

function toNumOrNull(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export default function ProfileClient({
  initial,
  garminMeta,
  metricHistory = [],
}: ProfileClientProps) {
  const buildValues = (init: ProfileValues) => ({
    name: init.name,
    birthDate: init.birthDate,
    height: init.height === null ? "" : String(init.height),
    targetWeight:
      init.targetWeight === null ? "" : String(init.targetWeight),
    targetDate: init.targetDate,
    restingHRBase:
      init.restingHRBase === null ? "" : String(init.restingHRBase),
    maxHR: init.maxHR === null ? "" : String(init.maxHR),
    lthr: init.lthr === null ? "" : String(init.lthr),
    lthrPace: formatPace(init.lthrPace),
    targetCalories:
      init.targetCalories === null ? "" : String(init.targetCalories),
  });
  // initial 값이 바뀌면 (router.refresh 등) form 재초기화.
  // initialKey로 변경 감지 → 렌더 중 setState (React 권장 derived state 패턴).
  const [values, setValues] = useState(() => buildValues(initial));
  const initialKey =
    `${initial.maxHR}|${initial.lthr}|${initial.lthrPace}|` +
    `${initial.restingHRBase}|${initial.targetCalories}|${initial.targetWeight}|` +
    `${initial.targetDate}|${initial.birthDate}|${initial.height}|${initial.name}`;
  const [prevKey, setPrevKey] = useState(initialKey);
  if (prevKey !== initialKey) {
    // 렌더 중 setState (React 권장 패턴: derived state from props change)
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    setPrevKey(initialKey);
    setValues(buildValues(initial));
  }
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
      targetDate: values.targetDate || null,
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

      {garminMeta && <GarminSyncSection meta={garminMeta} />}

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

          <Field label="목표 도달 예정일" hint="감량 진행도 계산에 사용">
            <input
              type="date"
              value={values.targetDate}
              onChange={(e) => setField("targetDate", e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
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
                max={220}
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
                min={80}
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
              max={5000}
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

      {metricHistory.length > 0 && <MetricHistorySection entries={metricHistory} />}
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

function GarminSyncSection({ meta }: { meta: GarminMeta }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataTypes: ["user_profile"] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data?.error ?? "동기화 실패");
        return;
      }
      // /api/sync는 200을 반환하면서 results[i].error로 개별 타입 실패를 보고.
      // 단, syncUserProfile은 부분 실패 시 데이터를 apply한 후에 throw하므로
      // 에러가 있어도 DB가 갱신될 수 있음 → 무조건 refresh.
      const profileResult = (data?.results as Array<{ dataType: string; error?: string }> | undefined)
        ?.find((r) => r.dataType === "user_profile");
      if (profileResult?.error) {
        setMessage(`부분 실패 (일부 데이터 갱신): ${profileResult.error}`);
      } else {
        setMessage("동기화 완료");
      }
      setTimeout(() => router.refresh(), 600);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "네트워크 오류");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] text-dim tracking-wider uppercase">
            Garmin 자동 동기화
          </div>
          <div className="text-[12px] text-sub mt-1">
            maxHR · LTHR · VO2max를 Garmin에서 자동 가져옵니다
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-3 py-1.5 rounded-md bg-card border border-[#2a2a2a] text-sm hover:border-accent/60 disabled:opacity-50 transition-colors"
        >
          {syncing ? "동기화 중..." : "지금 싱크"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <SourceBadge label="maxHR" source={meta.maxHRSource} />
        <SourceBadge label="LTHR" source={meta.lthrSource} />
        {meta.vo2maxRunning !== null && (
          <div className="col-span-2 text-dim">
            VO2max:{" "}
            <span className="text-bright font-[family-name:var(--font-geist-mono)]">
              {meta.vo2maxRunning}
            </span>
          </div>
        )}
        {meta.garminSyncedAt && (
          <div className="col-span-2 text-[11px] text-dim">
            마지막 싱크: {new Date(meta.garminSyncedAt).toLocaleString("ko-KR")}
          </div>
        )}
      </div>

      {message && (
        <div className="mt-3 text-[12px] text-accent">{message}</div>
      )}
    </div>
  );
}

function SourceBadge({
  label,
  source,
}: {
  label: string;
  source: string | null;
}) {
  if (!source) return <div className="text-dim">{label}: 미설정</div>;
  const badge =
    source === "garmin"
      ? "bg-blue-900/40 text-blue-300"
      : "bg-amber-900/40 text-amber-300";
  return (
    <div>
      <span className="text-dim">{label}: </span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge}`}>
        {source === "garmin" ? "Garmin 자동" : "수동"}
      </span>
    </div>
  );
}

function MetricHistorySection({ entries }: { entries: MetricChangeEntry[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 mt-8">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        프로필 변경 이력
      </div>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {entries.map((e) => {
          const date = new Date(e.changedAt).toLocaleDateString("ko-KR");
          const time = new Date(e.changedAt).toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          });
          const fieldLabel = FIELD_LABELS[e.field] ?? e.field;
          const unit = FIELD_UNITS[e.field] ?? "";
          const reasonLabel = e.reason ? REASON_LABELS[e.reason] ?? e.reason : "";
          const sourceBadge =
            e.source === "garmin"
              ? "bg-blue-900/40 text-blue-300"
              : "bg-amber-900/40 text-amber-300";
          return (
            <div
              key={e.id}
              className="flex items-center gap-3 text-[12px] py-2 border-b border-border/40 last:border-0"
            >
              <div className="text-dim w-20 shrink-0">
                {date.slice(5)} {time}
              </div>
              <div className="w-20 text-bright">{fieldLabel}</div>
              <div className="flex-1 font-[family-name:var(--font-geist-mono)] text-sub">
                {e.oldValue ?? "—"} → <span className="text-bright">{e.newValue ?? "—"}</span>
                {unit && <span className="text-dim ml-1">{unit}</span>}
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${sourceBadge}`}>
                {e.source === "garmin" ? "Garmin" : "수동"}
              </span>
              {reasonLabel && (
                <span className="text-[10px] text-dim w-24 text-right">
                  {reasonLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
