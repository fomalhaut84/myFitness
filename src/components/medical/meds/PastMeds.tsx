// #544: 지난 복약 — 종료 연도별. 다시 시작 (복사해 새 행) — 장기 · 단기 모두 (#550: 단기는 같은 일수로 복사 · restartFrom).
import Link from "next/link";
import type { MedicationDto } from "@/lib/medication/dto";
import { courseDays } from "@/lib/medication/period";
import { PILL, medPillClass, medPillText } from "./med-style";

function byEndYear(meds: readonly MedicationDto[]): [string, MedicationDto[]][] {
  const groups = new Map<string, MedicationDto[]>();
  for (const m of [...meds].sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))) {
    const year = (m.endDate ?? m.startDate).slice(0, 4);
    groups.set(year, [...(groups.get(year) ?? []), m]);
  }
  return [...groups.entries()];
}

export default function PastMeds({ meds }: { meds: readonly MedicationDto[] }) {
  return (
    <section aria-labelledby="past-meds">
      <h2 id="past-meds" className="mb-2.5 text-[13px] font-medium text-bright">
        지난 복약
      </h2>
      {meds.length === 0 ? (
        <p className="text-xs text-dim">끝난 복약이 여기에 연도별로 모입니다</p>
      ) : (
        <div className="rounded-xl border border-border bg-card px-1 pb-2">
          {byEndYear(meds).map(([year, list]) => (
            <div key={year}>
              <h3 className="mx-3 mb-1.5 mt-3 font-[family-name:var(--font-geist-mono)] text-xs font-medium text-sub">{year}</h3>
              <ul>
                {list.map((m) => (
                  <li key={m.id} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-border px-3 py-2 text-[13px] first:border-t-0">
                    <span className="min-w-0">
                      <Link href={`/medical/meds/${m.id}/edit`} className="text-bright hover:underline">
                        {m.name}
                      </Link>{" "}
                      <span className={`${PILL} ${medPillClass(m)}`}>{medPillText(m)}</span>
                    </span>
                    <span className="font-[family-name:var(--font-geist-mono)] text-xs text-sub">
                      {m.startDate} ~ {m.endDate}
                      {m.regimen === "short_term" && m.endDate ? ` · ${courseDays(m.startDate, m.endDate)}일` : ""}
                    </span>
                    <span>
                      <Link href={`/medical/meds/new?from=${m.id}`} className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs hover:border-border-hover">
                        다시 시작
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
