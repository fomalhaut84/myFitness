"use client";

import SleepSummary from "@/components/sleep/SleepSummary";
import SleepScoreChart from "@/components/sleep/SleepScoreChart";

interface LastNight {
  totalSleep: number;
  sleepScore: number | null;
  deepSleep: number | null;
  lightSleep: number | null;
  remSleep: number | null;
  awakeDuration: number | null;
  sleepStart: string;
  sleepEnd: string;
}

interface ScorePoint {
  date: string;
  score: number | null;
}

interface SleepRecord {
  date: string;
  totalSleep: number;
  sleepScore: number | null;
  deepSleep: number | null;
  lightSleep: number | null;
  remSleep: number | null;
  sleepStart: string;
  sleepEnd: string;
}

interface SleepClientProps {
  lastNight: LastNight | null;
  scoreHistory: ScorePoint[];
  recentRecords: SleepRecord[];
}

function formatSleepTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCHours().toString().padStart(2, "0")}:${kst.getUTCMinutes().toString().padStart(2, "0")}`;
}

export default function SleepClient({
  lastNight,
  scoreHistory,
  recentRecords,
}: SleepClientProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">수면</h1>
        <p className="text-dim text-sm">수면 분석</p>
      </div>

      {/* 어젯밤 요약 */}
      {lastNight ? (
        <div className="mb-6">
          <SleepSummary {...lastNight} />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-5 mb-6 text-center text-dim text-[13px]">
          어젯밤 수면 데이터 없음
        </div>
      )}

      {/* 수면 점수 추세 */}
      <div className="mb-6">
        <SleepScoreChart data={scoreHistory} />
      </div>

      {/* 최근 수면 기록 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          최근 수면 기록
        </div>
        {recentRecords.length > 0 ? (
          <div className="space-y-3">
            {recentRecords.map((r, i) => (
              <div key={r.date}>
                {i > 0 && <div className="border-t border-border mb-3" />}
                <a
                  href={`/sleep/${r.date}`}
                  className="flex items-center justify-between hover:bg-surface/50 rounded-lg -mx-2 px-2 py-1 transition-colors"
                >
                  <div>
                    <div className="text-[13px]">{r.date}</div>
                    <div className="text-[11px] text-dim">
                      {formatTime(r.sleepStart)} → {formatTime(r.sleepEnd)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[13px]">
                    <span className="font-[family-name:var(--font-geist-mono)]">
                      {formatSleepTime(r.totalSleep)}
                    </span>
                    {r.sleepScore !== null && (
                      <span className="text-dim">
                        점수{" "}
                        <span className="text-bright font-semibold">
                          {r.sleepScore}
                        </span>
                      </span>
                    )}
                  </div>
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-dim text-[13px]">
            수면 기록 없음
          </div>
        )}
      </div>
    </div>
  );
}
