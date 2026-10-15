import SourceBadge from "@/components/ui/SourceBadge";
import { muscleMassLabel } from "@/lib/data-source";

export interface BodyRecord {
  date: string;
  weight: number;
  bmi: number | null;
  bodyFat: number | null;
  muscleMass: number | null;
  source: string;
}

/** 최근 체중 기록 목록 — body-client 에서 분리 (#514: 출처 배지 · OMRON 은 골격근량 표기) */
export default function RecentBodyRecords({ records }: { records: BodyRecord[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 mt-6">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">최근 체중 기록</div>
      {records.length > 0 ? (
        <div className="space-y-3">
          {records.map((r, i) => (
            <div key={r.date}>
              {i > 0 && <div className="border-t border-border mb-3" />}
              <div className="flex flex-wrap items-center justify-between gap-y-1">
                <span className="flex items-center gap-2 text-[13px]">
                  {r.date}
                  <SourceBadge source={r.source} />
                </span>
                <div className="flex items-center gap-4 text-[13px]">
                  <span className="font-[family-name:var(--font-geist-mono)]">
                    {r.weight.toFixed(1)}
                    <span className="text-dim ml-1">kg</span>
                  </span>
                  {r.bodyFat !== null && (
                    <span className="font-[family-name:var(--font-geist-mono)]">
                      {r.bodyFat.toFixed(1)}
                      <span className="text-dim ml-1">%</span>
                    </span>
                  )}
                  {r.muscleMass !== null && (
                    <span className="font-[family-name:var(--font-geist-mono)]">
                      {r.muscleMass.toFixed(1)}
                      <span className="text-dim ml-1">kg {muscleMassLabel(r.source)}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-dim text-[13px]">체중 기록 없음</div>
      )}
    </div>
  );
}
