// #396 (M15-4): 레이스 표 (최신순). 이름은 Garmin 활동 이름 그대로 — `달리기` · `10km 러닝` 도 그대로 (이름을 지어내지 않는다).
import Link from "next/link";
import { formatClock, formatPace } from "@/lib/format";
import { historyDayPath } from "@/lib/history/route-params";
import type { RaceRow } from "@/lib/history/records";
import { ACTIVITY_RECHECK_DAYS } from "@/lib/garmin/activity-recheck";

// #414: 레이스 표시는 매일 싱크가 최근 N일 활동을 되돌아봐 반영된다. 그보다 오래된 활동은 명시 재조회 (`backfill:history --types=activities`).
// `--to` 필수 (PR #474 Codex P2): 생략하면 스크립트가 끝을 `oldestFetchedDate − 1일` 로 잡아 이미 가져온 범위 안의 날짜는 from > to 로 거부된다
const RECHECK_NOTE = `최근 ${ACTIVITY_RECHECK_DAYS}일 안의 활동은 다음 싱크에 반영됩니다. 더 오래된 활동은 npm run backfill:history -- --types=activities --from=YYYY-MM-DD --to=YYYY-MM-DD 로 재조회합니다.`;

export default function RaceTable({ races }: { races: readonly RaceRow[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[13px] font-medium text-muted">
        레이스 <span className="ml-1 font-normal text-sub">{races.length}건 · Garmin 에서 레이스로 표시한 활동</span>
      </h2>
      {races.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-[13px] text-sub">
          레이스로 표시된 활동이 없습니다. 워치나 Garmin Connect 에서 활동 유형을 레이스로 바꾸면 — {RECHECK_NOTE}
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
      <p className="mt-2.5 text-[11px] text-sub">이름은 Garmin 활동 이름 그대로입니다. 레이스 표시를 워치나 Garmin Connect 에서 바꾸면 — {RECHECK_NOTE}</p>
    </section>
  );
}
