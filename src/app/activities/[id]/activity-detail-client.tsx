"use client";

import { useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import ActivityDetail from "@/components/activity/ActivityDetail";
import SplitChart from "@/components/activity/SplitChart";

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
}

interface Props {
  activity: ActivityData;
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

export default function ActivityDetailClient({ activity }: Props) {
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

  return (
    <div>
      <ActivityDetail {...activity} />

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
