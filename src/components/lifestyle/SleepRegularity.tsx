import { regularityLabel, type RegularityLabel } from "@/lib/sleep/regularity";

const REGULARITY_COLORS: Record<RegularityLabel, string> = { "매우 규칙적": "#22c55e", 규칙적: "#60a5fa", 보통: "#f59e0b", 불규칙: "#ef4444" };

interface SleepEntry {
  date: string;
  sleepStartHour: number; // 소수점 시간 (예: 23.5 = 23:30)
  wakeUpHour: number;
}

interface SleepRegularityProps {
  entries: SleepEntry[];
}

function formatHour(h: number): string {
  // 음수 처리 (자정 이전)
  const adjusted = h < 0 ? h + 24 : h >= 24 ? h - 24 : h;
  const hours = Math.floor(adjusted);
  const mins = Math.round((adjusted - hours) * 60);
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

function calcStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export default function SleepRegularity({ entries }: SleepRegularityProps) {
  if (entries.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          수면 규칙성 (14일)
        </div>
        <div className="text-[13px] text-dim text-center py-4">데이터 없음</div>
      </div>
    );
  }

  const bedtimes = entries.map((e) => e.sleepStartHour);
  const waketimes = entries.map((e) => e.wakeUpHour);

  const avgBedtime = bedtimes.reduce((s, v) => s + v, 0) / bedtimes.length;
  const avgWakeup = waketimes.reduce((s, v) => s + v, 0) / waketimes.length;
  const bedtimeStdDev = calcStdDev(bedtimes);

  // #455: 라벨 임계는 lib/sleep/regularity.ts 가 정본 (MCP get_sleep regularity 와 같은 값)
  const label = regularityLabel(bedtimeStdDev);
  const regularity = { label, color: REGULARITY_COLORS[label] };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        수면 규칙성 (14일)
      </div>

      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-lg font-semibold" style={{ color: regularity.color }}>
          {regularity.label}
        </span>
        <span className="text-[11px] text-dim">
          편차 ±{(bedtimeStdDev * 60).toFixed(0)}분
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] text-dim mb-1">평균 취침</div>
          <div className="text-[15px] font-[family-name:var(--font-geist-mono)]">
            {formatHour(avgBedtime)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-dim mb-1">평균 기상</div>
          <div className="text-[15px] font-[family-name:var(--font-geist-mono)]">
            {formatHour(avgWakeup)}
          </div>
        </div>
      </div>
    </div>
  );
}
