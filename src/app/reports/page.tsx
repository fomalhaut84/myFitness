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

  async function generate(type: string, force = false) {
    setGenerating(type);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, force }),
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
        <div className="space-y-4">
          {reports.map((r) => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: TYPE_COLORS[r.category] ?? "#737373" }}
                />
                <span
                  className="text-[11px] tracking-wider uppercase"
                  style={{ color: TYPE_COLORS[r.category] ?? "#737373" }}
                >
                  {TYPE_LABELS[r.category] ?? r.category}
                </span>
                <span className="text-[11px] text-dim">
                  {r.reportDate ?? new Date(r.createdAt).toLocaleDateString("ko-KR")}
                </span>
                <button
                  onClick={() => generate(r.category.replace("_report", ""), true)}
                  disabled={generating !== null}
                  className="ml-auto text-[10px] text-dim hover:text-sub transition-colors disabled:opacity-50"
                >
                  재생성
                </button>
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
      )}
    </div>
  );
}
