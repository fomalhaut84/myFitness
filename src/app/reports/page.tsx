"use client";

import { useState, useEffect } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

interface Report {
  id: string;
  category: string;
  reportDate: string | null;
  response: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  morning_report: "모닝 리포트",
  evening_report: "이브닝 리포트",
  weekly_report: "주간 리포트",
};

const TYPE_COLORS: Record<string, string> = {
  morning_report: "#f59e0b",
  evening_report: "#a78bfa",
  weekly_report: "#22c55e",
};

/** KST 기준 today/yesterday YYYY-MM-DD 반환. */
function getKstTodayYesterday(): { today: string; yesterday: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
  const today = fmt.format(new Date());
  const yesterdayDate = new Date(`${today}T00:00:00+09:00`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = fmt.format(yesterdayDate);
  return { today, yesterday };
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reports?days=14")
      .then((r) => r.json())
      .then((data) => setReports(data.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function generate(type: string, force = false, reportDate?: string) {
    setGenerating(type);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, force, reportDate }),
      });
      const data = await res.json();
      if (data.result) {
        // 새 리포트 추가 후 리로드
        const refreshed = await fetch("/api/reports?days=14");
        const refreshData = await refreshed.json();
        setReports(refreshData.data ?? []);
      }
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">리포트</h1>
          <p className="text-dim text-sm">모닝 / 이브닝 / 주간 AI 리포트</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => generate("morning")}
            disabled={generating !== null}
            className="px-3 py-1.5 rounded-lg text-[12px] border border-border text-sub hover:text-bright hover:border-border-hover transition-colors disabled:opacity-50"
          >
            {generating === "morning" ? "생성 중..." : "모닝 생성"}
          </button>
          <button
            onClick={() => generate("evening")}
            disabled={generating !== null}
            className="px-3 py-1.5 rounded-lg text-[12px] border border-border text-sub hover:text-bright hover:border-border-hover transition-colors disabled:opacity-50"
          >
            {generating === "evening" ? "생성 중..." : "이브닝 생성"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-dim text-[13px]">로딩 중...</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-dim text-[13px]">리포트 없음</div>
      ) : (
        (() => {
          const { today, yesterday } = getKstTodayYesterday();
          // 재생성 가능 카테고리: morning/evening만 (weekly는 자동 cron 외 재생성 안 함).
          // 재생성 가능 record: reportDate가 KST today/yesterday일 때만 (과거 컨텍스트 보장 불가).
          const canRegenerate = (r: Report) =>
            (r.category === "morning_report" || r.category === "evening_report") &&
            r.reportDate !== null &&
            (r.reportDate === today || r.reportDate === yesterday);
          return (
            <div className="space-y-4">
              {reports.map((r) => (
                <div
                  key={r.id}
                  className="bg-card border border-border rounded-xl p-5"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: TYPE_COLORS[r.category] ?? "#737373",
                      }}
                    />
                    <span
                      className="text-[11px] tracking-wider uppercase"
                      style={{ color: TYPE_COLORS[r.category] ?? "#737373" }}
                    >
                      {TYPE_LABELS[r.category] ?? r.category}
                    </span>
                    <span className="text-[11px] text-dim">
                      {r.reportDate ??
                        new Date(r.createdAt).toLocaleDateString("ko-KR")}
                    </span>
                    {canRegenerate(r) && (
                      <button
                        onClick={() =>
                          generate(
                            r.category.replace("_report", ""),
                            true,
                            r.reportDate ?? undefined
                          )
                        }
                        disabled={generating !== null}
                        className="ml-auto text-[10px] text-dim hover:text-sub transition-colors disabled:opacity-50"
                      >
                        재생성
                      </button>
                    )}
                  </div>
                  <div
                    className="prose prose-invert prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(
                        marked.parse(r.response, { async: false }) as string
                      ),
                    }}
                  />
                </div>
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}
