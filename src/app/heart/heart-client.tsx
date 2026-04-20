"use client";

import TrendLineChart from "@/components/ui/TrendLineChart";

interface DataPoint {
  date: string;
  value: number | null;
}

interface HRRecord {
  date: string;
  restingHR: number | null;
  avgHR: number | null;
  maxHR: number | null;
  minHR: number | null;
  hrvStatus: number | null;
}

interface HeartClientProps {
  todayRestingHR: number | null;
  todayHRV: number | null;
  hrTrend: DataPoint[];
  hrvTrend: DataPoint[];
  respirationTrend: DataPoint[];
  recentRecords: HRRecord[];
}

export default function HeartClient({
  todayRestingHR,
  todayHRV,
  hrTrend,
  hrvTrend,
  respirationTrend,
  recentRecords,
}: HeartClientProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">심박</h1>
        <p className="text-dim text-sm">심박수 / HRV 분석</p>
      </div>

      {/* 오늘 요약 */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[11px] text-dim tracking-wider uppercase mb-2">
            안정시 심박
          </div>
          <div className="text-2xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {todayRestingHR ?? "—"}
            {todayRestingHR !== null && (
              <span className="text-sm text-dim font-normal ml-1">bpm</span>
            )}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-[11px] text-dim tracking-wider uppercase mb-2">
            HRV
          </div>
          <div className="text-2xl font-semibold font-[family-name:var(--font-geist-mono)]">
            {todayHRV ?? "—"}
            {todayHRV !== null && (
              <span className="text-sm text-dim font-normal ml-1">ms</span>
            )}
          </div>
        </div>
      </div>

      {/* 추세 차트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <TrendLineChart
          title="안정시 심박 추세 (30일)"
          data={hrTrend}
          color="#ef4444"
          unit="bpm"
        />
        <TrendLineChart
          title="HRV 추세 (30일)"
          data={hrvTrend}
          color="#f59e0b"
          unit="ms"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <TrendLineChart
          title="호흡수 추세 (30일)"
          data={respirationTrend}
          color="#22c55e"
          unit="회/분"
        />
      </div>

      {/* 최근 기록 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          최근 심박 기록
        </div>
        {recentRecords.length > 0 ? (
          <div className="space-y-3">
            {recentRecords.map((r, i) => (
              <div key={r.date}>
                {i > 0 && <div className="border-t border-border mb-3" />}
                <div className="flex items-center justify-between">
                  <span className="text-[13px]">{r.date}</span>
                  <div className="flex items-center gap-4 text-[13px]">
                    {r.restingHR !== null && (
                      <span>
                        <span className="text-dim text-[11px] mr-1">안정</span>
                        <span className="font-[family-name:var(--font-geist-mono)]">
                          {r.restingHR}
                        </span>
                      </span>
                    )}
                    {r.maxHR !== null && (
                      <span>
                        <span className="text-dim text-[11px] mr-1">최대</span>
                        <span className="font-[family-name:var(--font-geist-mono)]">
                          {r.maxHR}
                        </span>
                      </span>
                    )}
                    {r.hrvStatus !== null && (
                      <span>
                        <span className="text-dim text-[11px] mr-1">HRV</span>
                        <span className="font-[family-name:var(--font-geist-mono)]">
                          {r.hrvStatus}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-dim text-[13px]">
            심박 기록 없음
          </div>
        )}
      </div>
    </div>
  );
}
