"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RevertField = "maxHR" | "lthr";

interface HrValues {
  maxHR: number | null;
  lthr: number | null;
  lthrPace: number | null; // sec/km
}

export interface GarminMeta {
  maxHRSource: string | null;
  lthrSource: string | null;
  lthrAutoDetected: boolean | null;
  vo2maxRunning: number | null;
  garminSyncedAt: string | null;
  /** 프로필에 저장된 현재 값 */
  current: HrValues;
  /** #505: 최근 싱크 기준 Garmin 값 — 수동 보호 중이어도 비교할 수 있게 */
  garmin: HrValues;
}

const FIELD_NAMES: Record<RevertField, string> = { maxHR: "maxHR", lthr: "LTHR" };
const REFRESH_DELAY_MS = 600;

/** sec → "M:SS" (반올림으로 60초 발생 방지) */
function formatPace(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return null;
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatHr(v: HrValues, field: RevertField): string {
  if (field === "maxHR") return v.maxHR !== null ? `${v.maxHR} bpm` : "—";
  const parts = [
    v.lthr !== null ? `${v.lthr} bpm` : null,
    formatPace(v.lthrPace) ? `${formatPace(v.lthrPace)}/km` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function manualFields(meta: GarminMeta, exclude: RevertField | null): RevertField[] {
  const fields: RevertField[] = [];
  if (meta.maxHRSource === "manual" && exclude !== "maxHR") fields.push("maxHR");
  if (meta.lthrSource === "manual" && exclude !== "lthr") fields.push("lthr");
  return fields;
}

/** /api/sync (user_profile) 실행 → 사용자 메시지. 실패는 throw 대신 메시지로. */
async function runProfileSync(stillManual: RevertField[]): Promise<string> {
  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataTypes: ["user_profile"] }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return data?.error ?? "동기화 실패";
  // /api/sync는 200을 반환하면서 results[i].error로 개별 타입 실패를 보고.
  // 단, syncUserProfile은 부분 실패 시 데이터를 apply한 후에 throw하므로
  // 에러가 있어도 DB가 갱신될 수 있음 → 호출부는 무조건 refresh.
  const profileResult = (data?.results as Array<{ dataType: string; error?: string }> | undefined)
    ?.find((r) => r.dataType === "user_profile");
  if (profileResult?.error) return `부분 실패 (일부 데이터 갱신): ${profileResult.error}`;
  // #505: 수동 보호 항목은 싱크가 건너뛴다 — "완료"만 보여주면 갱신된 것으로 오해한다
  if (stillManual.length > 0) {
    const names = stillManual.map((f) => FIELD_NAMES[f]).join(" · ");
    return `동기화 완료 — 수동 항목(${names})은 갱신하지 않음`;
  }
  return "동기화 완료";
}

export default function GarminSyncSection({ meta }: { meta: GarminMeta }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function withBusy(task: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await task());
      setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "네트워크 오류");
    } finally {
      setBusy(false);
    }
  }

  function handleSync() {
    return withBusy(() => runProfileSync(manualFields(meta, null)));
  }

  function handleRevert(field: RevertField) {
    return withBusy(async () => {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revertToGarmin: [field] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return data?.error ?? "되돌리기 실패";
      }
      return runProfileSync(manualFields(meta, field));
    });
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
          disabled={busy}
          className="px-3 py-1.5 rounded-md bg-card border border-[#2a2a2a] text-sm hover:border-accent/60 disabled:opacity-50 transition-colors"
        >
          {busy ? "동기화 중..." : "지금 싱크"}
        </button>
      </div>

      <div className="space-y-2 text-[12px]">
        {(["maxHR", "lthr"] as const).map((field) => (
          <MetricSourceRow
            key={field}
            field={field}
            source={field === "maxHR" ? meta.maxHRSource : meta.lthrSource}
            current={formatHr(meta.current, field)}
            garmin={formatHr(meta.garmin, field)}
            busy={busy}
            onRevert={() => handleRevert(field)}
          />
        ))}
        {meta.vo2maxRunning !== null && (
          <div className="text-dim">
            VO2max:{" "}
            <span className="text-bright font-[family-name:var(--font-geist-mono)]">
              {meta.vo2maxRunning}
            </span>
          </div>
        )}
        {meta.garminSyncedAt && (
          <div className="text-[11px] text-dim">
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

function MetricSourceRow({
  field,
  source,
  current,
  garmin,
  busy,
  onRevert,
}: {
  field: RevertField;
  source: string | null;
  current: string;
  garmin: string;
  busy: boolean;
  onRevert: () => void;
}) {
  const isManual = source === "manual";
  // 수동 보호 중일 때만 Garmin 값을 따로 보여준다 (자동이면 현재 값이 곧 Garmin 값)
  const differs = isManual && garmin !== "—" && garmin !== current;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-dim w-12">{FIELD_NAMES[field]}</span>
      <SourceBadge source={source} />
      <span className="text-bright font-[family-name:var(--font-geist-mono)]">{current}</span>
      {isManual && (
        <span
          className={`font-[family-name:var(--font-geist-mono)] ${differs ? "text-amber-300" : "text-dim"}`}
        >
          · Garmin {garmin}
        </span>
      )}
      {isManual && (
        <button
          type="button"
          onClick={onRevert}
          disabled={busy}
          className="ml-auto px-2 py-0.5 rounded border border-[#2a2a2a] text-[11px] hover:border-accent/60 disabled:opacity-50 transition-colors"
        >
          Garmin 자동으로
        </button>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span className="text-dim">미설정</span>;
  const badge =
    source === "garmin"
      ? "bg-blue-900/40 text-blue-300"
      : "bg-amber-900/40 text-amber-300";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge}`}>
      {source === "garmin" ? "Garmin 자동" : "수동"}
    </span>
  );
}
