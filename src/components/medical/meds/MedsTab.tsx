// #544: 복약 탭 — 복용 중 · 복용 기간 타임라인 · 지난 복약.
import type { MedicationDto } from "@/lib/medication/dto";
import { medicationStatus } from "@/lib/medication/period";
import { buildTimeline } from "@/lib/medication/timeline";
import ActiveMedCard from "./ActiveMedCard";
import MedTimeline from "./MedTimeline";
import PastMeds from "./PastMeds";
import { itemLabel } from "./item-label";

interface MedsTabProps {
  meds: readonly MedicationDto[];
  checkupDates: readonly string[];
  customItems: Readonly<Record<string, string>>;
  today: string;
}

export default function MedsTab({ meds, checkupDates, customItems, today }: MedsTabProps) {
  const active = meds
    .filter((m) => medicationStatus(m, today) === "active")
    .sort((a, b) => (a.regimen === b.regimen ? a.startDate.localeCompare(b.startDate) : a.regimen === "long_term" ? -1 : 1));
  const past = meds.filter((m) => medicationStatus(m, today) === "ended");
  const timeline = buildTimeline(meds, checkupDates, today);

  return (
    <div>
      <section aria-labelledby="active-meds" className="mb-6">
        <h2 id="active-meds" className="mb-2.5 text-[13px] font-medium text-bright">
          복용 중 <span className="ml-1 text-xs font-normal text-dim">{active.length}개</span>
        </h2>
        {active.length === 0 ? (
          <p className="text-xs text-dim">지금 먹고 있는 약 · 영양제가 없습니다</p>
        ) : (
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
            {active.map((m) => (
              <ActiveMedCard key={m.id} med={m} today={today} related={m.relatedItems.map((c) => itemLabel(c, customItems))} />
            ))}
          </div>
        )}
      </section>
      {timeline && <MedTimeline timeline={timeline} />}
      <PastMeds meds={past} />
    </div>
  );
}
