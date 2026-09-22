// #396 (M15-4): "이 기간의 이벤트" — 차트 (`role="img"`) 위 마커의 글자 대응물. 날짜 · 종류 (글리프 + 글자) · 내용 · 링크.
// 최신순, 30건 넘으면 "외 N건". 빈 상태는 무엇을 하면 채워지는지 말한다.
import Link from "next/link";
import { EVENT_KIND_LABELS, type HistoryEvent } from "@/lib/history/markers";
import MarkerGlyph from "./MarkerGlyph";

const MAX_ROWS = 30;
const LINK_LABELS = { race: "그 날 보기", plan: "플랜 보기", metric: "프로필 보기" } as const;

export default function EventList({ events }: { events: readonly HistoryEvent[] }) {
  const sorted = [...events].sort((a, b) => (a.ymd < b.ymd ? 1 : a.ymd > b.ymd ? -1 : 0));
  const shown = sorted.slice(0, MAX_ROWS);
  return (
    <section className="mt-3.5 rounded-xl border border-border bg-card">
      <h3 className="px-3.5 pt-2.5 text-[12px] font-medium text-sub">
        이 기간의 이벤트 <span className="text-dim">{sorted.length}건</span>
      </h3>
      {sorted.length === 0 ? (
        <p className="px-3.5 pb-3 pt-2 text-[12px] text-dim">
          이 기간에 표시할 이벤트가 없습니다. Garmin 에서 활동을 레이스로 표시하거나, 프로필에서 maxHR · LTHR 을 바꾸면 여기에 남습니다.
        </p>
      ) : (
        <ol className="py-1">
          {shown.map((e, i) => (
            <li
              key={`${e.kind}-${e.ymd}-${e.title}`}
              className={`grid grid-cols-[78px_1fr] items-baseline gap-x-2.5 px-3.5 py-2 sm:grid-cols-[92px_auto_1fr_auto] ${i > 0 ? "border-t border-[#1c1c1c]" : ""}`}
            >
              <time className="font-[family-name:var(--font-geist-mono)] text-[13px] text-muted">{e.ymd}</time>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-sub">
                <MarkerGlyph kind={e.kind} />
                {EVENT_KIND_LABELS[e.kind]}
              </span>
              <span className="col-span-2 min-w-0 text-bright sm:col-span-1">
                {e.title}
                {e.detail && <span className="ml-1.5 font-[family-name:var(--font-geist-mono)] text-[12px] text-sub">{e.detail}</span>}
                {e.endYmd && <span className="ml-1.5 font-[family-name:var(--font-geist-mono)] text-[12px] text-sub">~ {e.endYmd}</span>}
              </span>
              {e.href && (
                <Link href={e.href} className="col-span-2 justify-self-start whitespace-nowrap text-[12px] text-sub hover:text-bright sm:col-span-1">
                  {LINK_LABELS[e.kind]}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
      {sorted.length > MAX_ROWS && <p className="border-t border-[#1c1c1c] px-3.5 py-2 text-[12px] text-dim">외 {sorted.length - MAX_ROWS}건</p>}
    </section>
  );
}
