// #396 (M15-4): 레이스 표 (최신순). 이름은 Garmin 활동 이름 그대로 — `달리기` · `10km 러닝` 도 그대로 (이름을 지어내지 않는다).
import Link from "next/link";
import { formatClock, formatPace } from "@/lib/format";
import { historyDayPath } from "@/lib/history/route-params";
import type { RaceRow } from "@/lib/history/records";

export default function RaceTable({ races }: { races: readonly RaceRow[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[13px] font-medium text-muted">
        레이스 <span className="ml-1 font-normal text-sub">{races.length}건 · Garmin 에서 레이스로 표시한 활동</span>
      </h2>
      {races.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-[13px] text-sub">
          레이스로 표시된 활동이 없습니다. 워치나 Garmin Connect 에서 활동 유형을 레이스로 바꾸면 다음 싱크에 반영됩니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[12px] font-medium text-sub">
                <th className="px-3.5 py-2.5 text-left font-medium">날짜</th>
                <th className="px-3.5 py-2.5 text-left font-medium">이름</th>
                <th className="px-3.5 py-2.5 text-right font-medium">거리</th>
                <th className="px-3.5 py-2.5 text-right font-medium">페이스</th>
                <th className="px-3.5 py-2.5 text-right font-medium">시간</th>
              </tr>
            </thead>
            <tbody>
              {races.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-3.5 py-2.5 font-[family-name:var(--font-geist-mono)] text-[13px] text-sub">
                    <Link href={historyDayPath(r.ymd)} className="underline decoration-border-hover underline-offset-[3px] hover:text-bright">
                      {r.ymd}
                    </Link>
                  </td>
                  <td className="min-w-[170px] px-3.5 py-2.5 text-[14px] text-muted">
                    <Link href={historyDayPath(r.ymd)} className="hover:text-bright">
                      {r.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-[family-name:var(--font-geist-mono)] text-[14px] font-medium text-bright">
                    {r.distanceM === null ? <span className="font-normal text-dim">—</span> : (r.distanceM / 1000).toFixed(2)}
                    {r.distanceM !== null && <span className="ml-0.5 text-[11px] font-normal text-sub">km</span>}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-[family-name:var(--font-geist-mono)] text-[14px] font-medium text-bright">
                    {r.avgPace === null ? <span className="font-normal text-dim">—</span> : formatPace(r.avgPace)}
                    {r.avgPace !== null && <span className="ml-0.5 text-[11px] font-normal text-sub">/km</span>}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-[family-name:var(--font-geist-mono)] text-[14px] font-medium text-bright">
                    {formatClock(r.durationSec)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2.5 text-[11px] text-sub">이름은 Garmin 활동 이름 그대로입니다. 레이스 표시는 워치나 Garmin Connect 에서 바꾸면 다음 싱크에 반영됩니다.</p>
    </section>
  );
}
