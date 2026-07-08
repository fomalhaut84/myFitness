"use client";

import { useState, useRef, useCallback, useEffect } from "react";
// isomorphic-dompurify: SSR(Node)에서도 sanitize 가능. server component인 page.tsx가
// initial reports를 props로 전달하면 첫 렌더가 SSR에서 일어나는데, 순수 dompurify는
// 브라우저 DOM이 필요해 Node에선 sanitize가 undefined가 되어 throw.
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { todayKSTString, yesterdayKST, ymdKST } from "@/lib/garmin/utils";

export interface Report {
  id: string;
  category: string;
  reportDate: string | null;
  response: string;
  createdAt: string;
}

interface ReportsResponse {
  data?: Report[];
  nextCursor?: string | null;
}

type FilterType = "all" | "morning" | "evening" | "weekly";

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

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "morning", label: "모닝" },
  { value: "evening", label: "이브닝" },
  { value: "weekly", label: "주간" },
];

const PAGE_LIMIT = 14;

// cursor / days 둘 다 미지정 시 API는 전체 history에서 최신 limit만 반환 (페이지네이션 의도).
// days 명시는 후방 호환용이라 첫 페이지 fetch에선 의도적으로 보내지 않음 — 7일 필터에 갇히면
// sparse 카테고리(주간 등) 이전 리포트 접근 불가.
function buildQuery(filter: FilterType, cursor?: string | null): string {
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (filter !== "all") qs.set("type", filter);
  if (cursor) qs.set("cursor", cursor);
  return qs.toString();
}

interface Props {
  initialReports: Report[];
  initialNextCursor: string | null;
}

export default function ReportsClient({ initialReports, initialNextCursor }: Props) {
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // race condition 가드: 필터 변경 / 더 보기가 동시 진행될 때 이전 요청 응답을 폐기
  const requestIdRef = useRef(0);
  // generate가 await 중 사용자가 필터를 바꿔도 최신 filter로 refresh 하도록 ref 동기화.
  // React 19 react-hooks/refs 룰: ref mutation은 effect 안에서만.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  // 재생성 가능 record: reportDate가 KST today/yesterday일 때만
  // (preSync/MCP/프롬프트가 모두 today 기준이라 과거 컨텍스트 보장 불가).
  const today = todayKSTString();
  const yesterday = ymdKST(yesterdayKST());
  const canRegenerate = (r: Report) =>
    (r.category === "morning_report" || r.category === "evening_report") &&
    r.reportDate !== null &&
    (r.reportDate === today || r.reportDate === yesterday);

  // filter state는 await 중 stale될 수 있어 인자로 명시 주입.
  const fetchFirstPage = useCallback(async (currentFilter: FilterType) => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    setReports([]);
    setNextCursor(null);
    try {
      const res = await fetch(`/api/reports?${buildQuery(currentFilter)}`);
      const data = (await res.json().catch(() => ({}))) as ReportsResponse & {
        error?: string;
      };
      if (reqId !== requestIdRef.current) return;
      if (!res.ok) {
        setErrorMsg(data.error ?? `리포트 조회 실패 (HTTP ${res.status})`);
        return;
      }
      setReports(data.data ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`네트워크 오류: ${msg}`);
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const handleFilter = (value: FilterType) => {
    if (value === filter) return;
    setFilter(value);
    fetchFirstPage(value);
  };

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const reqId = requestIdRef.current;
    setLoadingMore(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/reports?${buildQuery(filter, nextCursor)}`);
      const data = (await res.json().catch(() => ({}))) as ReportsResponse & {
        error?: string;
      };
      if (reqId !== requestIdRef.current) return;
      if (!res.ok) {
        setErrorMsg(data.error ?? `더 보기 실패 (HTTP ${res.status})`);
        return;
      }
      setReports((prev) => [...prev, ...(data.data ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`네트워크 오류: ${msg}`);
    } finally {
      // setLoadingMore는 가드 없이 무조건 false로. generate/필터변경이 끼어들어
      // requestIdRef가 ++되면 가드된 setLoadingMore가 스킵되어 영원히 true에 갇힘.
      setLoadingMore(false);
    }
  }, [filter, nextCursor, loadingMore]);

  // M#191: SSE 연결 관리. mount 시 진행중 job 감지 → 재개, 언마운트 시 close.
  const eventSourceRef = useRef<EventSource | null>(null);

  const attachSSE = useCallback(
    (jobId: string, category: string) => {
      eventSourceRef.current?.close();
      const es = new EventSource(`/api/reports/stream?jobId=${jobId}`);
      eventSourceRef.current = es;
      const shortType = category.replace("_report", "");
      setGenerating(shortType);

      es.addEventListener("status", () => {
        // running / pending 상태 유지 — 별도 UI 반영 없음 (generating 유지 만으로 충분)
      });
      es.addEventListener("completed", () => {
        es.close();
        if (eventSourceRef.current === es) eventSourceRef.current = null;
        setGenerating(null);
        void fetchFirstPage(filterRef.current);
      });
      es.addEventListener("failed", (event) => {
        const raw = (event as MessageEvent).data;
        let msg = "리포트 생성 실패";
        try {
          const parsed = JSON.parse(raw) as { errorMessage?: string };
          if (parsed.errorMessage) msg = parsed.errorMessage;
        } catch {
          /* ignore */
        }
        setErrorMsg(msg);
        es.close();
        if (eventSourceRef.current === es) eventSourceRef.current = null;
        setGenerating(null);
      });
      // 네트워크 끊김 시 EventSource 는 자동 재연결 시도. 명시 close 후엔 X.
      es.onerror = () => {
        // 조용히. 재연결 성공 시 status 이벤트 재수신.
      };
    },
    [fetchFirstPage],
  );

  async function generate(type: string, force = false, reportDate?: string) {
    setGenerating(type);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, force, reportDate }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        status?: string;
        category?: string;
        error?: string;
      };
      if (!res.ok || !data.jobId || !data.category) {
        setErrorMsg(data.error ?? `리포트 생성 실패 (HTTP ${res.status})`);
        setGenerating(null);
        return;
      }
      // 이미 completed 인 경우 (job 재사용) — 즉시 refetch 후 종료
      if (data.status === "completed") {
        setGenerating(null);
        await fetchFirstPage(filterRef.current);
        return;
      }
      attachSSE(data.jobId, data.category);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`네트워크 오류: ${msg}`);
      setGenerating(null);
    }
  }

  // 마운트 시 오늘/어제 날짜의 진행중 job 감지 → SSE 재개.
  // 이탈 시 EventSource close (백엔드 job 은 무관하게 계속).
  useEffect(() => {
    let cancelled = false;
    const candidates: {
      category: "morning_report" | "evening_report" | "weekly_report";
      reportDate: string;
    }[] = [
      { category: "morning_report", reportDate: today },
      { category: "evening_report", reportDate: today },
      { category: "weekly_report", reportDate: today },
    ];
    (async () => {
      for (const c of candidates) {
        try {
          const res = await fetch(
            `/api/reports/current-job?category=${c.category}&reportDate=${c.reportDate}`,
          );
          if (!res.ok) continue;
          const data = (await res.json()) as { job: { id: string } | null };
          if (cancelled) return;
          if (data.job) {
            attachSSE(data.job.id, c.category);
            return; // 첫 매칭만 재개 — 동시에 여러 SSE 불필요
          }
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [attachSSE, today]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
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

      <div className="flex gap-1 mb-4">
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilter(f.value)}
            disabled={loading || loadingMore}
            className={`px-3 py-1.5 rounded-lg text-[12px] transition-colors disabled:opacity-50 ${
              filter === f.value
                ? "bg-card border border-border-hover text-bright"
                : "border border-border text-sub hover:text-bright hover:border-border-hover"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-[12px]">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-dim text-[13px]">로딩 중...</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-dim text-[13px]">리포트 없음</div>
      ) : (
        <>
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

          {nextCursor && (
            <div className="mt-6 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-2 rounded-lg text-[12px] border border-border text-sub hover:text-bright hover:border-border-hover transition-colors disabled:opacity-50"
              >
                {loadingMore ? "불러오는 중..." : "더 보기"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
