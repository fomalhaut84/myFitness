// #396 (M15-4): 개인 기록 — 카드 8장이 아니라 한 컨테이너 8행 (#394 일 뷰의 장부). 왼쪽 제목 · 값 mono · 오른쪽 **날짜가 링크**.
// 사용자의 질문은 "얼마" 보다 "언제" 라서 날짜를 값과 같은 급으로 둔다. 러닝 기록은 소요 시간이 먼저, 페이스 · 거리는 부제.
import Link from "next/link";
import { formatClock, formatPace } from "@/lib/format";
import { historyDayPath, historyMetricQuery, historyMonthPath } from "@/lib/history/route-params";
import type { PersonalRecords, RunningRecordRow } from "@/lib/history/records";

interface RecordRowView {
  key: string;
  label: string;
  value: string | null;
  unit?: string;
  sub?: string;
  race?: boolean;
  /** 기록 없을 때의 설명 */
  empty?: string;
  date?: string;
  href?: string;
}

const BUCKET_LABELS = { "5k": "5K 최고", "10k": "10K 최고", HM: "하프 최고", FM: "풀 최고" } as const;
const BUCKET_EMPTY = { "5k": "4.5km 이상 달린 기록이 없습니다", "10k": "9km 이상 달린 기록이 없습니다", HM: "20km 이상 달린 기록이 없습니다", FM: "40km 이상 달린 기록이 없습니다" } as const;

function runningRow(key: keyof typeof BUCKET_LABELS, r: RunningRecordRow | null): RecordRowView {
  if (!r) return { key, label: BUCKET_LABELS[key], value: null, empty: BUCKET_EMPTY[key] };
  return {
    key,
    label: BUCKET_LABELS[key],
    value: formatClock(r.durationSec),
    sub: `${formatPace(r.avgPace)}/km · ${(r.distanceM / 1000).toFixed(2)}km`,
    race: r.race,
    date: r.ymd,
    href: historyDayPath(r.ymd),
  };
}

export function buildRecordRows(records: PersonalRecords): RecordRowView[] {
  const { byBucket, longest, bestMonth, bestVo2max, lowestRestingHR } = records;
  return [
    runningRow("5k", byBucket["5k"]),
    runningRow("10k", byBucket["10k"]),
    runningRow("HM", byBucket.HM),
    runningRow("FM", byBucket.FM),
    longest
      ? {
          key: "longest",
          label: "최장 거리",
          value: (longest.distanceM / 1000).toFixed(2),
          unit: "km",
          sub: `${formatClock(longest.durationSec)} · ${formatPace(longest.avgPace)}/km`,
          race: longest.race,
          date: longest.ymd,
          href: historyDayPath(longest.ymd),
        }
      : { key: "longest", label: "최장 거리", value: null, empty: "러닝 기록이 없습니다" },
    bestMonth
      ? {
          key: "month",
          label: "최다 km 월",
          value: bestMonth.km.toFixed(1),
          unit: "km",
          sub: `${bestMonth.count !== null ? `${bestMonth.count}회` : ""}${bestMonth.current ? " · 이번 달 (진행 중)" : ""}`.replace(/^ · /, ""),
          date: bestMonth.ym,
          href: `${historyMonthPath(bestMonth.ym)}${historyMetricQuery("runningKm")}`,
        }
      : { key: "month", label: "최다 km 월", value: null, empty: "러닝 기록이 없습니다" },
    bestVo2max
      ? { key: "vo2max", label: "최고 VO2max", value: bestVo2max.value.toFixed(1), sub: "처음 도달한 날", date: bestVo2max.ymd, href: `${historyDayPath(bestVo2max.ymd)}${historyMetricQuery("vo2max")}` }
      : { key: "vo2max", label: "최고 VO2max", value: null, empty: "VO2max 기록이 없습니다" },
    lowestRestingHR
      ? { key: "rhr", label: "최저 안정시 심박", value: String(Math.round(lowestRestingHR.value)), unit: "bpm", sub: "처음 도달한 날", date: lowestRestingHR.ymd, href: `${historyDayPath(lowestRestingHR.ymd)}${historyMetricQuery("restingHR")}` }
      : { key: "rhr", label: "최저 안정시 심박", value: null, empty: "안정시 심박 기록이 없습니다" },
  ];
}

export default function RecordsPanel({ records, lowerBound }: { records: PersonalRecords; lowerBound: string }) {
  const rows = buildRecordRows(records);
  return (
    <section>
      <h2 className="mb-2 text-[13px] font-medium text-muted">
        개인 기록 <span className="ml-1 font-normal text-sub">{lowerBound} 부터, 러닝 기준</span>
      </h2>
      <dl className="rounded-xl border border-border bg-card">
        {rows.map((row, i) => (
          <div
            key={row.key}
            className={`grid grid-cols-[1fr_auto] items-baseline gap-x-3.5 gap-y-0.5 px-4 sm:grid-cols-[132px_1fr_auto] ${
              i > 0 ? "border-t border-border" : ""
            } ${row.value === null ? "bg-[#121212] py-2.5" : "py-3"}`}
          >
            <dt className={`col-span-2 text-[12px] sm:col-span-1 sm:text-[13px] ${row.value === null ? "text-sub" : "text-muted"}`}>{row.label}</dt>
            {row.value === null ? (
              <>
                <dd className="text-[13px] text-dim">{row.empty}</dd>
                <dd className="text-[13px] text-dim">—</dd>
              </>
            ) : (
              <>
                <dd className="min-w-0 font-[family-name:var(--font-geist-mono)] text-[16px] font-medium leading-relaxed text-bright sm:text-[17px]">
                  {row.value}
                  {row.unit && <span className="ml-1 text-[12px] font-normal text-sub">{row.unit}</span>}
                  {row.sub && <span className="ml-2 text-[12px] font-normal text-sub">{row.sub}</span>}
                  {row.race && (
                    <span className="ml-2 inline-block rounded-full border border-border-hover px-[7px] align-[2px] font-sans text-[10px] font-medium text-muted">레이스</span>
                  )}
                </dd>
                <dd className="whitespace-nowrap font-[family-name:var(--font-geist-mono)] text-[13px] text-sub">
                  {row.href ? (
                    <Link href={row.href} className="underline decoration-border-hover underline-offset-[3px] hover:text-bright">
                      {row.date}
                    </Link>
                  ) : (
                    row.date
                  )}
                </dd>
              </>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
