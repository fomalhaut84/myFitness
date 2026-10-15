import SourceBadge from "@/components/ui/SourceBadge";

export interface BodyDetail {
  date: string;
  source: string;
  visceralFatLevel: number | null;
  basalMetabolism: number | null;
  bodyAge: number | null;
  skeletalMusclePct: number | null;
  skeletalMuscleKg: number | null;
}

/** 골격근률 · 골격근량은 OMRON 이 따로 준다 (코드 261 · 294) — 한쪽만 있어도 표시 (PR #519 Codex P2) */
function skeletalMuscleText(pct: number | null, kg: number | null): string | null {
  const parts = [pct === null ? null : `${pct.toFixed(1)}%`, kg === null ? null : `${kg.toFixed(1)}kg`].filter(
    (p): p is string => p !== null
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function Item({ label, value, unit }: { label: string; value: string | null; unit?: string }) {
  if (value === null) return null;
  return (
    <div>
      <div className="text-[11px] text-dim mb-1">{label}</div>
      <div className="text-lg font-semibold font-[family-name:var(--font-geist-mono)]">
        {value}
        {unit && <span className="text-xs text-dim font-normal ml-1">{unit}</span>}
      </div>
    </div>
  );
}

/** #514: OMRON 체성분계 상세 (내장지방 · 기초대사 · 체연령 · 골격근). 값이 하나도 없으면 렌더하지 않는다 */
export default function BodyDetailCard({ detail }: { detail: BodyDetail | null }) {
  if (
    detail === null ||
    [
      detail.visceralFatLevel,
      detail.basalMetabolism,
      detail.bodyAge,
      detail.skeletalMusclePct,
      detail.skeletalMuscleKg,
    ].every((v) => v === null)
  ) {
    return null;
  }
  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] text-dim tracking-wider uppercase">체성분 상세</div>
        <div className="flex items-center gap-2 text-[11px] text-dim">
          {detail.date}
          <SourceBadge source={detail.source} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Item label="골격근" value={skeletalMuscleText(detail.skeletalMusclePct, detail.skeletalMuscleKg)} />
        <Item label="내장지방 레벨" value={detail.visceralFatLevel === null ? null : String(Math.round(detail.visceralFatLevel * 10) / 10)} />
        <Item label="기초대사" value={detail.basalMetabolism === null ? null : detail.basalMetabolism.toLocaleString("ko-KR")} unit="kcal" />
        <Item label="체연령" value={detail.bodyAge === null ? null : String(detail.bodyAge)} unit="세" />
      </div>
    </div>
  );
}
