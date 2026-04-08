"use client";

import { useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

interface SleepData {
  date: string;
  totalSleep: number;
  deepSleep: number | null;
  lightSleep: number | null;
  remSleep: number | null;
  awakeDuration: number | null;
  sleepScore: number | null;
  sleepStart: string;
  sleepEnd: string;
  avgSpO2: number | null;
  avgRespiration: number | null;
  lowestRespiration: number | null;
  highestRespiration: number | null;
  avgSleepStress: number | null;
  bodyBatteryChange: number | null;
  restingHR: number | null;
  hrvOvernight: number | null;
  sleepScoreDetails: Record<string, unknown> | null;
}

function fmtSleep(min: number): string {
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCHours().toString().padStart(2, "0")}:${kst.getUTCMinutes().toString().padStart(2, "0")}`;
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="bg-surface rounded-lg p-3">
      <div className="text-[10px] text-dim tracking-wider uppercase mb-1">{label}</div>
      <div className="text-lg font-semibold font-[family-name:var(--font-geist-mono)]">
        {value}
        {unit && <span className="text-xs text-dim font-normal ml-1">{unit}</span>}
      </div>
    </div>
  );
}

const STAGE_COLORS = [
  { key: "deepSleep", label: "깊은 수면", color: "#3b82f6" },
  { key: "lightSleep", label: "얕은 수면", color: "#93c5fd" },
  { key: "remSleep", label: "REM", color: "#a78bfa" },
  { key: "awakeDuration", label: "깨어남", color: "#525252" },
] as const;

const SCORE_LABELS: Record<string, string> = {
  EXCELLENT: "훌륭",
  GOOD: "양호",
  FAIR: "보통",
  POOR: "부족",
};

export default function SleepDetailClient({ record }: { record: SleepData }) {
  const [aiEval, setAiEval] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const stages = STAGE_COLORS.map((s) => ({
    ...s,
    value: record[s.key] as number | null,
  })).filter((s) => s.value != null && s.value > 0);

  const totalDuration = stages.reduce((sum, s) => sum + (s.value ?? 0), 0);

  const details = record.sleepScoreDetails;

  async function requestAiEval() {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `${record.date} 수면을 평가해줘: 총 ${fmtSleep(record.totalSleep)}, 점수 ${record.sleepScore ?? "없음"}, ` +
            `깊은수면 ${record.deepSleep ?? 0}분, REM ${record.remSleep ?? 0}분, ` +
            `HRV ${record.hrvOvernight ? Math.round(record.hrvOvernight) : "없음"}ms, ` +
            `SpO2 ${record.avgSpO2 ?? "없음"}%, 안정시HR ${record.restingHR ?? "없음"}, ` +
            `배터리충전 ${record.bodyBatteryChange ?? "없음"}. 3줄 이내로 평가해줘.`,
          category: "sleep",
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
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">{record.date} 수면</h1>
        <p className="text-dim text-sm">
          {fmtTime(record.sleepStart)} → {fmtTime(record.sleepEnd)}
        </p>
      </div>

      {/* 요약 */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <div className="flex items-baseline gap-3 mb-4">
          <span className="text-3xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {fmtSleep(record.totalSleep)}
          </span>
          {record.sleepScore != null && (
            <span className="text-sm text-dim">
              점수 <span className="text-bright font-semibold">{record.sleepScore}</span>
            </span>
          )}
          {record.bodyBatteryChange != null && (
            <span className="text-sm text-dim">
              🔋 {record.bodyBatteryChange > 0 ? `+${record.bodyBatteryChange}` : record.bodyBatteryChange}
            </span>
          )}
        </div>

        {/* 수면 단계 바 */}
        {totalDuration > 0 && (
          <div className="mb-4">
            <div className="flex h-4 rounded-full overflow-hidden bg-surface">
              {stages.map((s, i) => (
                <div
                  key={i}
                  className="h-full"
                  style={{
                    width: `${((s.value ?? 0) / totalDuration) * 100}%`,
                    backgroundColor: s.color,
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              {stages.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5 text-[12px]">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-dim">{s.label}</span>
                  <span className="font-[family-name:var(--font-geist-mono)]">{fmtSleep(s.value ?? 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 수면 점수 세부 */}
      {details && (
        <div className="bg-card border border-border rounded-xl p-5 mb-6">
          <div className="text-[11px] text-dim tracking-wider uppercase mb-4">수면 점수 세부</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {typeof details.duration === "string" && (
              <ScoreItem label="총시간" qualifier={details.duration} />
            )}
            {typeof details.stress === "string" && (
              <ScoreItem label="스트레스" qualifier={details.stress} />
            )}
            {typeof details.awakeCount === "string" && (
              <ScoreItem label="깨어남" qualifier={details.awakeCount} />
            )}
            {typeof details.restlessness === "string" && (
              <ScoreItem label="뒤척임" qualifier={details.restlessness} />
            )}
            {details.deepPercentage != null && (
              <ScoreItem
                label="깊은수면"
                qualifier={String((details.deepPercentage as Record<string, unknown>).qualifier ?? "")}
                value={(details.deepPercentage as Record<string, unknown>).value as number}
                unit="%"
              />
            )}
            {details.remPercentage != null && (
              <ScoreItem
                label="REM"
                qualifier={String((details.remPercentage as Record<string, unknown>).qualifier ?? "")}
                value={(details.remPercentage as Record<string, unknown>).value as number}
                unit="%"
              />
            )}
            {details.lightPercentage != null && (
              <ScoreItem
                label="얕은수면"
                qualifier={String((details.lightPercentage as Record<string, unknown>).qualifier ?? "")}
                value={(details.lightPercentage as Record<string, unknown>).value as number}
                unit="%"
              />
            )}
          </div>
        </div>
      )}

      {/* 바이탈 지표 */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">바이탈 지표</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {record.avgSpO2 != null && (
            <Stat label="SpO2" value={record.avgSpO2.toFixed(0)} unit="%" />
          )}
          {record.avgRespiration != null && (
            <Stat label="호흡수" value={record.avgRespiration.toFixed(0)} unit="회/분" />
          )}
          {record.lowestRespiration != null && (
            <Stat label="최저 호흡수" value={record.lowestRespiration.toFixed(0)} unit="회/분" />
          )}
          {record.highestRespiration != null && (
            <Stat label="최고 호흡수" value={record.highestRespiration.toFixed(0)} unit="회/분" />
          )}
          {record.avgSleepStress != null && (
            <Stat label="수면 스트레스" value={record.avgSleepStress.toFixed(0)} />
          )}
          {record.restingHR != null && (
            <Stat label="안정시 심박" value={String(record.restingHR)} unit="bpm" />
          )}
          {record.hrvOvernight != null && (
            <Stat label="야간 HRV" value={Math.round(record.hrvOvernight).toString()} unit="ms" />
          )}
        </div>
      </div>

      {/* AI 평가 */}
      <div>
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
            {aiLoading ? "분석 중..." : "🤖 AI 수면 평가"}
          </button>
        )}
      </div>
    </div>
  );
}

function ScoreItem({ label, qualifier, value, unit }: { label: string; qualifier: string; value?: number; unit?: string }) {
  const qualLabel = SCORE_LABELS[qualifier] ?? qualifier;
  const color = qualifier === "EXCELLENT" || qualifier === "GOOD" ? "#22c55e"
    : qualifier === "FAIR" ? "#f59e0b"
    : qualifier === "POOR" ? "#ef4444" : "#737373";

  return (
    <div className="bg-surface rounded-lg p-3">
      <div className="text-[10px] text-dim tracking-wider uppercase mb-1">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[13px] font-medium" style={{ color }}>{qualLabel}</span>
        {value != null && (
          <span className="text-[11px] text-dim font-[family-name:var(--font-geist-mono)]">
            {Math.round(value)}{unit}
          </span>
        )}
      </div>
    </div>
  );
}
