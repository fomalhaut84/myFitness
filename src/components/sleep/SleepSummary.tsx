interface SleepSummaryProps {
  totalSleep: number;    // minutes
  sleepScore: number | null;
  deepSleep: number | null;
  lightSleep: number | null;
  remSleep: number | null;
  awakeDuration: number | null;
  sleepStart: string;
  sleepEnd: string;
}

function formatSleepTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const STAGES = [
  { key: "deepSleep", label: "깊은 수면", color: "#3b82f6" },
  { key: "lightSleep", label: "얕은 수면", color: "#93c5fd" },
  { key: "remSleep", label: "REM", color: "#a78bfa" },
  { key: "awakeDuration", label: "깨어남", color: "#525252" },
] as const;

export default function SleepSummary(props: SleepSummaryProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        어젯밤 수면
      </div>

      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-3xl font-semibold font-[family-name:var(--font-geist-mono)]">
          {formatSleepTime(props.totalSleep)}
        </span>
        {props.sleepScore !== null && (
          <span className="text-sm text-dim">
            점수 <span className="text-bright font-semibold">{props.sleepScore}</span>
          </span>
        )}
      </div>

      <div className="text-[12px] text-dim mb-5">
        {formatTime(props.sleepStart)} → {formatTime(props.sleepEnd)}
      </div>

      {/* 수면 단계 수평 바 */}
      <SleepStagesBar
        totalSleep={props.totalSleep}
        deepSleep={props.deepSleep}
        lightSleep={props.lightSleep}
        remSleep={props.remSleep}
        awakeDuration={props.awakeDuration}
      />

      {/* 단계별 수치 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        {STAGES.map((stage) => {
          const value = props[stage.key];
          if (value === null) return null;
          return (
            <div key={stage.key} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: stage.color }}
              />
              <span className="text-[12px] text-dim">{stage.label}</span>
              <span className="text-[12px] font-[family-name:var(--font-geist-mono)]">
                {formatSleepTime(value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SleepStagesBar({
  totalSleep,
  deepSleep,
  lightSleep,
  remSleep,
  awakeDuration,
}: {
  totalSleep: number;
  deepSleep: number | null;
  lightSleep: number | null;
  remSleep: number | null;
  awakeDuration: number | null;
}) {
  if (totalSleep === 0) return null;

  const segments = [
    { value: deepSleep ?? 0, color: "#3b82f6" },
    { value: lightSleep ?? 0, color: "#93c5fd" },
    { value: remSleep ?? 0, color: "#a78bfa" },
    { value: awakeDuration ?? 0, color: "#525252" },
  ].filter((s) => s.value > 0);

  return (
    <div className="flex h-3 rounded-full overflow-hidden bg-surface">
      {segments.map((seg, i) => (
        <div
          key={i}
          className="h-full"
          style={{
            width: `${(seg.value / totalSleep) * 100}%`,
            backgroundColor: seg.color,
          }}
        />
      ))}
    </div>
  );
}
