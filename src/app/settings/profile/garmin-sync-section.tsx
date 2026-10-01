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
  /** #505: 최근 싱크 기준 Garmin 러닝 존 심박 — 수동 보호 중이어도 비교할 수 있게 */
  garmin: Pick<HrValues, "maxHR" | "lthr">;
  /** #505: 최신 LT 감지 페이스 (FitnessMetricDaily · YYYY-MM-DD) — 참고 표시만, 비교 대상 아님 */
  ltDetection: { pace: number; date: string } | null;
}

const FIELD_NAMES: Record<RevertField, string> = { maxHR: "maxHR", lthr: "LTHR" };
const REFRESH_DELAY_MS = 600;

/** sec → "M:SS" (반올림으로 60초 발생 방지) */
function formatPace(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return null;
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatBpm(v: number | null): string {
  return v !== null ? `${v} bpm` : "—";
}

function formatCurrent(v: HrValues, field: RevertField): string {
  if (field === "maxHR") return formatBpm(v.maxHR);
  const pace = formatPace(v.lthrPace);
  if (v.lthr === null && !pace) return "—";
  return [formatBpm(v.lthr), pace ? `${pace}/km` : null].filter(Boolean).join(" · ");
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
        // throw → withBusy 가 메시지만 표시하고 refresh 는 생략
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "되돌리기 실패");
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
            current={formatCurrent(meta.current, field)}
            garminBpm={meta.garmin[field]}
            currentBpm={meta.current[field]}
            busy={busy}
            onRevert={() => handleRevert(field)}
          />
        ))}
        {meta.lthrSource === "manual" && meta.ltDetection && (
          <div className="text-[11px] text-dim">
            Garmin LT 감지 페이스: {formatPace(meta.ltDetection.pace)}/km ({meta.ltDetection.date})
          </div>
        )}
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
  garminBpm,
  currentBpm,
  busy,
  onRevert,
}: {
  field: RevertField;
  source: string | null;
  current: string;
  garminBpm: number | null;
  currentBpm: number | null;
  busy: boolean;
  onRevert: () => void;
}) {
  const isManual = source === "manual";
  // 수동 보호 중일 때만 Garmin 값을 따로 보여준다 (자동이면 현재 값이 곧 Garmin 값).
  // 비교는 싱크가 실제로 쓰는 러닝 존 심박만 — 페이스는 출처가 달라 비교하지 않는다 (사전 리뷰 major 1)
  const differs = isManual && garminBpm !== null && garminBpm !== currentBpm;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-dim w-12">{FIELD_NAMES[field]}</span>
      <SourceBadge source={source} />
      <span className="text-bright font-[family-name:var(--font-geist-mono)]">{current}</span>
      {isManual && (
        <span
          className={`font-[family-name:var(--font-geist-mono)] ${differs ? "text-amber-300" : "text-dim"}`}
        >
          · Garmin {formatBpm(garminBpm)}
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
