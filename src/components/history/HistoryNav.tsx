"use client";

// #394 (M15-2): `/history` 레벨 공용 네비. 브레드크럼이 곧 제목 (마지막 조각이 h1) · 연도 탭 또는 이전/다음 ·
// 네이티브 month/date 입력으로 점프 · "올해 / 이번 달 / 오늘".
// `NutritionDateNav` 의 팝오버 picker 대신 네이티브 입력을 직접 노출한다 — 모바일에서 OS 달력이 바로 뜬다.
// 하한은 상수(MIN_HISTORY_YMD)가 아니라 실제 최초 기록일 (`getHistoryLowerBound`) 을 서버에서 받는다.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDaysYmd, isValidYmd } from "@/lib/history/buckets";
import type { HistoryMetricId } from "@/lib/history/metrics";
import { addMonthsYm, dayOfWeekYmd, isValidYm } from "@/lib/history/month-cells";
import {
  historyDayPath,
  historyMetricQuery,
  historyMonthPath,
  historyYearPath,
  type HistoryRoute,
} from "@/lib/history/route-params";

interface HistoryNavProps {
  route: HistoryRoute;
  today: string;
  lowerBound: string;
  metric: HistoryMetricId;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const STEP_BASE = "rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors";
const STEP_ON = `${STEP_BASE} border-border text-muted hover:border-border-hover hover:text-bright`;
const STEP_OFF = `${STEP_BASE} cursor-not-allowed border-[#1c1c1c] text-dim`;

function StepLink({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return (
      <span aria-disabled className={STEP_OFF}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} className={STEP_ON}>
      {label}
    </Link>
  );
}

export default function HistoryNav({ route, today, lowerBound, metric }: HistoryNavProps) {
  const router = useRouter();
  const query = historyMetricQuery(metric);
  const minYear = Number(lowerBound.slice(0, 4));
  const maxYear = Number(today.slice(0, 4));
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);

  const crumbs: { href: string; label: string }[] = [{ href: `${historyYearPath(route.year)}${query}`, label: "기록" }];
  if (route.level !== "year") crumbs.push({ href: `${historyYearPath(route.year)}${query}`, label: String(route.year) });
  if (route.level === "day") crumbs.push({ href: `${historyMonthPath(route.ym)}${query}`, label: `${route.month}월` });

  let prev: string | null = null;
  let next: string | null = null;
  if (route.level === "month") {
    const p = addMonthsYm(route.ym, -1);
    const n = addMonthsYm(route.ym, 1);
    prev = p >= lowerBound.slice(0, 7) ? `${historyMonthPath(p)}${query}` : null;
    next = n <= today.slice(0, 7) ? `${historyMonthPath(n)}${query}` : null;
  } else if (route.level === "day") {
    const p = addDaysYmd(route.ymd, -1);
    const n = addDaysYmd(route.ymd, 1);
    prev = p >= lowerBound ? `${historyDayPath(p)}${query}` : null;
    next = n <= today ? `${historyDayPath(n)}${query}` : null;
  }

  const nowHref =
    route.level === "year"
      ? `${historyYearPath(maxYear)}${query}`
      : route.level === "month"
        ? `${historyMonthPath(today.slice(0, 7))}${query}`
        : `${historyDayPath(today)}${query}`;
  const nowLabel = route.level === "year" ? "올해" : route.level === "month" ? "이번 달" : "오늘";
  const inputClass =
    "rounded-lg border border-border bg-transparent px-2.5 py-1.5 font-[family-name:var(--font-geist-mono)] text-[13px] text-muted [color-scheme:dark] hover:border-border-hover";

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        {crumbs.map((c, i) => (
          <span key={`${c.label}${i}`} className="flex items-baseline gap-2">
            <Link href={c.href} className="text-sub hover:text-bright">
              {c.label}
            </Link>
            <span aria-hidden className="text-dim">
              ›
            </span>
          </span>
        ))}
        <h1 className="text-[22px] font-semibold tracking-tight text-bright sm:text-[26px]">
          {route.level === "year" && `${route.year}년`}
          {route.level === "month" && `${route.month}월`}
          {route.level === "day" && (
            <>
              {route.day}일<span className="ml-1.5 text-[14px] font-normal text-sub">{DAY_NAMES[dayOfWeekYmd(route.ymd)]}요일</span>
            </>
          )}
        </h1>
      </div>

      <div className="mb-5 mt-3.5 flex items-center justify-between gap-3">
        {route.level === "year" ? (
          <nav aria-label="연도" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {years.map((y) => (
              <Link
                key={y}
                href={`${historyYearPath(y)}${query}`}
                scroll={false}
                aria-current={y === route.year ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 font-[family-name:var(--font-geist-mono)] text-[13px] font-medium ${
                  y === route.year ? "bg-surface text-bright" : "text-sub hover:text-bright"
                }`}
              >
                {y}
              </Link>
            ))}
          </nav>
        ) : (
          <div className="flex gap-1.5">
            <StepLink href={prev} label="이전" />
            <StepLink href={next} label="다음" />
          </div>
        )}

        <div className="flex flex-none gap-1.5">
          {route.level === "month" && (
            <input
              type="month"
              aria-label="월 이동"
              value={route.ym}
              min={lowerBound.slice(0, 7)}
              max={today.slice(0, 7)}
              onChange={(e) => {
                // 데스크톱 Safari/Firefox 는 type=month 가 텍스트 입력으로 떨어진다 — 형식이 맞을 때만 이동
                const v = e.target.value;
                if (isValidYm(v) && v !== route.ym) router.push(`${historyMonthPath(v)}${query}`, { scroll: false });
              }}
              className={inputClass}
            />
          )}
          {route.level === "day" && (
            <input
              type="date"
              aria-label="날짜 이동"
              value={route.ymd}
              min={lowerBound}
              max={today}
              onChange={(e) => {
                const v = e.target.value;
                if (isValidYmd(v) && v !== route.ymd) router.push(`${historyDayPath(v)}${query}`, { scroll: false });
              }}
              className={inputClass}
            />
          )}
          <Link href={nowHref} scroll={false} className={STEP_ON}>
            {nowLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
