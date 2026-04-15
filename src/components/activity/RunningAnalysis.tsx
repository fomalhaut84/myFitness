"use client";

import TrendLineChart from "@/components/ui/TrendLineChart";
import { formatPace } from "@/lib/format";
import { calculateHRZone } from "@/lib/fitness/zones";

interface RunningRecord {
  date: string;
  avgPace: number | null;
  avgHR: number | null;
  maxHR: number | null;
  distance: number | null;
  trainingEffect: number | null;
  vo2maxEstimate: number | null;
}

interface RunningAnalysisProps {
  records: RunningRecord[];
  estimatedMaxHR: number;
  /** 사용자 실측 LTHR. 있으면 LTHR 기반, 없으면 maxHR × 0.9 근사. */
  userLTHR?: number | null;
}

const HR_ZONE_META = [
  { zone: 1, label: "회복", color: "#a3a3a3" },
  { zone: 2, label: "이지", color: "#22c55e" },
  { zone: 3, label: "에어로빅", color: "#60a5fa" },
  { zone: 4, label: "역치", color: "#f59e0b" },
  { zone: 5, label: "VO2max", color: "#ef4444" },
];

export default function RunningAnalysis({
  records,
  estimatedMaxHR,
  userLTHR,
}: RunningAnalysisProps) {
  // LTHR 결정: 사용자 실측 → maxHR × 0.9 근사
  const lthr = userLTHR && userLTHR > 0 ? userLTHR : Math.round(estimatedMaxHR * 0.9);
  const isMeasured = Boolean(userLTHR && userLTHR > 0);
  if (records.length === 0) return null;

  // HR존 분포 (LTHR 기반)
  const zoneCounts = [0, 0, 0, 0, 0];
  const withHR = records.filter((r) => r.avgHR !== null);
  for (const r of withHR) {
    const z = calculateHRZone(r.avgHR!, lthr);
    zoneCounts[z - 1]++;
  }
  const totalWithHR = withHR.length || 1;

  // 페이스 추세 (낮을수록 빠름 → 차트에서 반전)
  const paceData = records
    .filter((r) => r.avgPace !== null)
    .map((r) => ({
      date: r.date,
      value: r.avgPace ? Math.round(r.avgPace) : null,
    }));

  // VO2max 추세
  const vo2Data = records
    .filter((r) => r.vo2maxEstimate !== null)
    .map((r) => ({
      date: r.date,
      value: r.vo2maxEstimate ? Math.round(r.vo2maxEstimate * 10) / 10 : null,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">러닝 분석</h2>
        <p className="text-dim text-[12px] mb-4">최근 러닝 데이터 기반</p>
      </div>

      {/* HR존 분포 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          HR존 분포 ({withHR.length}회 러닝)
        </div>
        <div className="space-y-2">
          {HR_ZONE_META.map((z, i) => {
            const pct = Math.round((zoneCounts[i] / totalWithHR) * 100);
            return (
              <div key={z.zone} className="flex items-center gap-3">
                <span className="text-[11px] text-dim w-16">
                  Z{z.zone} {z.label}
                </span>
                <div className="flex-1 h-4 rounded bg-surface overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: z.color,
                    }}
                  />
                </div>
                <span className="text-[11px] font-[family-name:var(--font-geist-mono)] w-8 text-right">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
        <div className="text-[10px] text-dim mt-3">
          {isMeasured
            ? `LTHR ${lthr} bpm (실측)`
            : `LTHR ${lthr} bpm (최대심박 × 0.9 추정)`}
          {" · "}최대 심박 {estimatedMaxHR} bpm
        </div>
      </div>

      {/* 추세 차트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TrendLineChart
          title="평균 페이스 추세"
          data={paceData}
          color="#22c55e"
          unit="sec/km"
        />
        {vo2Data.length > 0 && (
          <TrendLineChart
            title="VO2max 추세"
            data={vo2Data}
            color="#60a5fa"
          />
        )}
      </div>

      {/* 최근 러닝 테이블 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          최근 러닝 기록
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-dim border-b border-border">
                <th className="text-left py-2 font-normal">날짜</th>
                <th className="text-right py-2 font-normal">거리</th>
                <th className="text-right py-2 font-normal">페이스</th>
                <th className="text-right py-2 font-normal">평균HR</th>
                <th className="text-right py-2 font-normal">TE</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 10).map((r) => (
                <tr key={r.date} className="border-b border-border/50">
                  <td className="py-2">{r.date}</td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)]">
                    {r.distance ? (r.distance / 1000).toFixed(2) : "—"}
                  </td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)]">
                    {r.avgPace ? formatPace(r.avgPace) : "—"}
                  </td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)]">
                    {r.avgHR ?? "—"}
                  </td>
                  <td className="text-right font-[family-name:var(--font-geist-mono)]">
                    {r.trainingEffect?.toFixed(1) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
