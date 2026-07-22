"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DOMPurify from "dompurify";
import { marked } from "marked";
import ActivityDetail from "@/components/activity/ActivityDetail";
import SplitChart from "@/components/activity/SplitChart";
import { formatPace } from "@/lib/format";

interface ActivityData {
  id: string;
  name: string;
  activityType: string;
  startTime: string;
  duration: number;
  distance: number | null;
  calories: number | null;
  avgHR: number | null;
  maxHR: number | null;
  avgPace: number | null;
  avgSpeed: number | null;
  elevationGain: number | null;
  trainingEffect: number | null;
  vo2maxEstimate: number | null;
  avgCadence: number | null;
  avgStrideLength: number | null;
  avgVerticalOscillation: number | null;
  avgGroundContactTime: number | null;
  aerobicTE: number | null;
  anaerobicTE: number | null;
  avgRespirationRate: number | null;
  lapCount: number | null;
  // M4-5: 강도 자동 분류
  zoneDistribution: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  estimatedZone: number | null;
  intensityScore: number | null;
  intensityLabel: string | null;
  // #261: 사용자 커스텀 코스명 태그
  routeTag: string | null;
}

interface SimilarActivity {
  id: string;
  name: string;
  date: string;
  startTimeIso: string;
  avgPace: number | null;
  avgHR: number | null;
  duration: number;
  distanceKm: number | null;
  intensityLabel: string | null;
  routeTag: string | null;
}

interface Props {
  activity: ActivityData;
  similarActivities?: SimilarActivity[];
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-2">{label}</div>
      <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)] tracking-tight">
        {value}
        {unit && <span className="text-sm text-dim font-normal ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export default function ActivityDetailClient({
  activity,
  similarActivities = [],
}: Props) {
  const [aiEval, setAiEval] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const hasDynamics = activity.avgCadence != null || activity.avgStrideLength != null ||
    activity.avgVerticalOscillation != null || activity.avgGroundContactTime != null;

  async function requestAiEval() {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `다음 운동을 평가해줘: ${activity.name} (${activity.activityType}), ` +
            `거리 ${activity.distance ? (activity.distance / 1000).toFixed(2) : 0}km, ` +
            `시간 ${Math.round(activity.duration / 60)}분, ` +
            `평균HR ${activity.avgHR ?? "없음"}, 최대HR ${activity.maxHR ?? "없음"}, ` +
            `유산소TE ${activity.aerobicTE?.toFixed(1) ?? "없음"}, ` +
            `케이던스 ${activity.avgCadence ?? "없음"}spm. ` +
            `간단히 3줄 이내로 평가해줘.`,
          category: "exercise",
        }),
      });
      const data = await res.json();
      setAiEval(data.result ?? data.error);
    } catch {
      setAiEval("AI 평가를 불러올 수 없습니다.");
    } finally {
      setAiLoading(false);
    }
  }

  const hasIntensity = activity.zoneDistribution !== null && activity.intensityLabel !== null;

  return (
    <div>
      <ActivityDetail {...activity} />

      {/* M4-5: 강도 분류 + HR Zone 분포 */}
      {hasIntensity && activity.zoneDistribution && (
        <IntensityBreakdown
          dist={activity.zoneDistribution}
          label={activity.intensityLabel!}
          score={activity.intensityScore}
          zone={activity.estimatedZone}
        />
      )}

      {/* 러닝 다이나믹스 */}
      {hasDynamics && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">러닝 다이나믹스</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {activity.avgCadence != null && (
              <Stat label="케이던스" value={String(activity.avgCadence)} unit="spm" />
            )}
            {activity.avgStrideLength != null && (
              <Stat label="보폭" value={(activity.avgStrideLength * 100).toFixed(0)} unit="cm" />
            )}
            {activity.avgVerticalOscillation != null && (
              <Stat label="수직 진동" value={activity.avgVerticalOscillation.toFixed(1)} unit="cm" />
            )}
            {activity.avgGroundContactTime != null && (
              <Stat label="지면접촉시간" value={activity.avgGroundContactTime.toFixed(0)} unit="ms" />
            )}
          </div>
        </div>
      )}

      {/* 추가 지표 */}
      {(activity.aerobicTE != null || activity.anaerobicTE != null || activity.avgRespirationRate != null || activity.lapCount != null) && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">추가 지표</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {activity.aerobicTE != null && (
              <Stat label="유산소 TE" value={activity.aerobicTE.toFixed(1)} />
            )}
            {activity.anaerobicTE != null && (
              <Stat label="무산소 TE" value={activity.anaerobicTE.toFixed(1)} />
            )}
            {activity.avgRespirationRate != null && (
              <Stat label="평균 호흡수" value={activity.avgRespirationRate.toFixed(0)} unit="회/분" />
            )}
            {activity.lapCount != null && (
              <Stat label="랩" value={String(activity.lapCount)} unit="개" />
            )}
          </div>
        </div>
      )}

      {/* km별 스플릿 (on-demand 조회) */}
      {activity.activityType.includes("running") && (
        <div className="mt-6">
          <SplitChart activityId={activity.id} />
        </div>
      )}

      {/* #261: 같은 코스 활동 비교 (러닝만, GPS 매칭 또는 routeTag). */}
      {activity.activityType.includes("running") && (
        <SameCourseComparison current={activity} similar={similarActivities} />
      )}

      {/* AI 평가 */}
      <div className="mt-6">
        {aiEval ? (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="text-[11px] text-dim tracking-wider uppercase mb-3">AI 평가</div>
            <div
              className="prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(
                  marked.parse(aiEval, { async: false }) as string
                ),
              }}
            />
          </div>
        ) : (
          <button
            onClick={requestAiEval}
            disabled={aiLoading}
            className="px-4 py-2 rounded-lg text-[13px] border border-border text-sub hover:text-bright hover:border-border-hover transition-colors disabled:opacity-50"
          >
            {aiLoading ? "분석 중..." : "🤖 AI 평가 요청"}
          </button>
        )}
      </div>
    </div>
  );
}

const ZONE_META = [
  { zone: 1, name: "회복", color: "#a3a3a3" },
  { zone: 2, name: "이지", color: "#22c55e" },
  { zone: 3, name: "에어로빅", color: "#60a5fa" },
  { zone: 4, name: "역치", color: "#f59e0b" },
  { zone: 5, name: "VO2max", color: "#ef4444" },
];

const LABEL_META: Record<string, { text: string; badge: string }> = {
  recovery: { text: "회복 런", badge: "bg-slate-700 text-slate-200" },
  easy: { text: "이지 런", badge: "bg-green-900/40 text-green-300" },
  tempo: { text: "템포 런", badge: "bg-blue-900/40 text-blue-300" },
  threshold: { text: "한계치 런", badge: "bg-amber-900/40 text-amber-300" },
  interval: { text: "인터벌", badge: "bg-red-900/40 text-red-300" },
  max: { text: "최대 강도", badge: "bg-red-900/60 text-red-200" },
};

function IntensityBreakdown({
  dist,
  label,
  score,
  zone,
}: {
  dist: { z1: number; z2: number; z3: number; z4: number; z5: number };
  label: string;
  score: number | null;
  zone: number | null;
}) {
  const total = dist.z1 + dist.z2 + dist.z3 + dist.z4 + dist.z5;
  const values = [dist.z1, dist.z2, dist.z3, dist.z4, dist.z5];
  const labelMeta = LABEL_META[label] ?? {
    text: label,
    badge: "bg-slate-700 text-slate-200",
  };

  function fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">강도 분석</h2>
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded ${labelMeta.badge}`}
          >
            {labelMeta.text}
          </span>
          {zone !== null && (
            <span className="text-[11px] text-dim">Zone {zone}</span>
          )}
          {score !== null && (
            <span className="text-[11px] text-dim">
              {score.toFixed(0)}점
            </span>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-3">
          HR Zone 분포
        </div>

        {/* 스택드 바 */}
        <div className="h-4 rounded bg-surface overflow-hidden flex mb-4">
          {ZONE_META.map((z, i) => {
            const pct = total > 0 ? (values[i] / total) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <div
                key={z.zone}
                style={{
                  width: `${pct}%`,
                  backgroundColor: z.color,
                }}
                title={`Z${z.zone} ${z.name}: ${pct.toFixed(1)}%`}
              />
            );
          })}
        </div>

        {/* 상세 리스트 */}
        <div className="grid grid-cols-5 gap-2 text-center text-[11px]">
          {ZONE_META.map((z, i) => {
            const sec = values[i];
            const pct = total > 0 ? (sec / total) * 100 : 0;
            return (
              <div key={z.zone}>
                <div
                  className="font-medium mb-0.5"
                  style={{ color: z.color }}
                >
                  Z{z.zone}
                </div>
                <div className="text-dim text-[10px]">{z.name}</div>
                <div className="font-[family-name:var(--font-geist-mono)] text-sub mt-1">
                  {fmt(sec)}
                </div>
                <div className="text-dim text-[10px]">
                  {pct.toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SameCourseComparison({
  current,
  similar,
}: {
  current: ActivityData;
  similar: SimilarActivity[];
}) {
  // 델타 계산 (매칭 활동 있을 때만).
  const prevPaces = similar
    .map((a) => a.avgPace)
    .filter((p): p is number => p !== null);
  const prevHRs = similar
    .map((a) => a.avgHR)
    .filter((h): h is number => h !== null);
  const avgPrevPace =
    prevPaces.length > 0
      ? prevPaces.reduce((s, p) => s + p, 0) / prevPaces.length
      : null;
  const avgPrevHR =
    prevHRs.length > 0
      ? Math.round(prevHRs.reduce((s, h) => s + h, 0) / prevHRs.length)
      : null;
  const paceDelta =
    current.avgPace !== null && avgPrevPace !== null
      ? Math.round(current.avgPace - avgPrevPace)
      : null;
  const hrDelta =
    current.avgHR !== null && avgPrevHR !== null
      ? current.avgHR - avgPrevHR
      : null;

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">
          이 코스의 다른 기록{" "}
          <span className="text-[11px] text-dim font-normal ml-1">
            (같은 시작점 ±10% 거리 또는 같은 태그)
          </span>
        </h2>
      </div>
      <div className="bg-card border border-border rounded-xl p-5">
        {/* 코스 태그 편집 */}
        <RouteTagEditor
          activityId={current.id}
          initialTag={current.routeTag}
        />

        {similar.length === 0 ? (
          <div className="text-[13px] text-dim text-center py-6">
            아직 이 코스에서 뛴 다른 기록이 없어요. 자주 뛰는 코스에 태그를
            붙여두면 이후 활동이 자동으로 함께 표시됩니다.
          </div>
        ) : (
          <>
            <div className="text-[11px] text-dim tracking-wider uppercase mt-4 mb-4">
              최근 {similar.length}회 대비
            </div>

            {/* 델타 카드 */}
            {(paceDelta !== null || hrDelta !== null) && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                {paceDelta !== null && (
                  <div className="bg-surface rounded-lg p-3 text-center">
                    <div className="text-[10px] text-dim mb-1">페이스 변화</div>
                    <div
                      className={`text-lg font-semibold font-[family-name:var(--font-geist-mono)] ${
                        paceDelta < 0
                          ? "text-accent"
                          : paceDelta > 0
                            ? "text-red-400"
                            : "text-sub"
                      }`}
                    >
                      {paceDelta < 0 ? "" : "+"}
                      {paceDelta}
                      <span className="text-[11px] text-dim font-normal ml-1">
                        초/km
                      </span>
                    </div>
                    <div className="text-[10px] text-dim">
                      {paceDelta < 0
                        ? "빨라짐"
                        : paceDelta > 0
                          ? "느려짐"
                          : "동일"}
                    </div>
                  </div>
                )}
                {hrDelta !== null && (
                  <div className="bg-surface rounded-lg p-3 text-center">
                    <div className="text-[10px] text-dim mb-1">심박 변화</div>
                    <div
                      className={`text-lg font-semibold font-[family-name:var(--font-geist-mono)] ${
                        hrDelta < 0
                          ? "text-accent"
                          : hrDelta > 0
                            ? "text-yellow-400"
                            : "text-sub"
                      }`}
                    >
                      {hrDelta > 0 ? "+" : ""}
                      {hrDelta}
                      <span className="text-[11px] text-dim font-normal ml-1">
                        bpm
                      </span>
                    </div>
                    <div className="text-[10px] text-dim">
                      {hrDelta < 0
                        ? "심박 낮아짐"
                        : hrDelta > 0
                          ? "심박 높아짐"
                          : "동일"}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 활동 목록 (클릭 시 해당 활동 페이지로) */}
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-dim border-b border-border">
                    <th className="text-left py-2 font-normal">날짜</th>
                    <th className="text-left py-2 font-normal">이름</th>
                    <th className="text-right py-2 font-normal">거리</th>
                    <th className="text-right py-2 font-normal">페이스</th>
                    <th className="text-right py-2 font-normal">HR</th>
                    <th className="text-right py-2 font-normal">강도</th>
                  </tr>
                </thead>
                <tbody>
                  {similar.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-border/50 hover:bg-surface/50 transition-colors"
                    >
                      <td className="py-2 text-dim">
                        <Link
                          href={`/activities/${a.id}`}
                          className="hover:text-bright transition-colors"
                        >
                          {a.date.slice(5)}
                        </Link>
                      </td>
                      <td className="py-2">
                        <Link
                          href={`/activities/${a.id}`}
                          className="hover:text-bright transition-colors"
                        >
                          {a.name}
                          {a.routeTag && (
                            <span
                              className="ml-2 text-[10px] text-accent border border-accent/40 rounded px-1 py-0.5"
                              title={`코스 태그: ${a.routeTag}`}
                            >
                              #{a.routeTag}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="text-right font-[family-name:var(--font-geist-mono)]">
                        {a.distanceKm ?? "—"}
                      </td>
                      <td className="text-right font-[family-name:var(--font-geist-mono)]">
                        {a.avgPace ? formatPace(a.avgPace) : "—"}
                      </td>
                      <td className="text-right font-[family-name:var(--font-geist-mono)]">
                        {a.avgHR ?? "—"}
                      </td>
                      <td className="text-right text-dim">
                        {a.intensityLabel ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RouteTagEditor({
  activityId,
  initialTag,
}: {
  activityId: string;
  initialTag: string | null;
}) {
  const router = useRouter();
  const [tag, setTag] = useState(initialTag ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    const trimmed = tag.trim();
    if (trimmed === (initialTag ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ routeTag: trimmed || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `요청 실패 (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-dim tracking-wider uppercase">
          코스 태그
        </span>
        {initialTag ? (
          <span className="text-[13px] text-accent">#{initialTag}</span>
        ) : (
          <span className="text-[13px] text-dim">미지정</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[11px] text-dim hover:text-bright transition-colors underline"
        >
          편집
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-dim tracking-wider uppercase">
        코스 태그
      </span>
      <input
        type="text"
        value={tag}
        maxLength={60}
        onChange={(e) => setTag(e.target.value)}
        placeholder="예: 우리 동네 5K"
        className="bg-surface border border-border rounded px-2 py-1 text-[13px] font-[family-name:var(--font-geist-mono)]"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="px-3 py-1 rounded text-[12px] border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
      >
        {saving ? "저장 중..." : "저장"}
      </button>
      <button
        type="button"
        onClick={() => {
          setTag(initialTag ?? "");
          setEditing(false);
          setError(null);
        }}
        className="px-3 py-1 rounded text-[12px] border border-border text-dim hover:text-bright transition-colors"
      >
        취소
      </button>
      {error && (
        <span className="text-[11px] text-red-400 w-full mt-1">{error}</span>
      )}
    </div>
  );
}
