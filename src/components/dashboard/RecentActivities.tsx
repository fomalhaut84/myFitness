interface Activity {
  id: string;
  name: string;
  activityType: string;
  startTime: string;
  duration: number;
  distance: number | null;
  avgPace: number | null;
  calories: number | null;
}

interface RecentActivitiesProps {
  activities: Activity[];
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}분`;
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}'${sec.toString().padStart(2, "0")}"`;
}

function formatDistance(meters: number): string {
  return (meters / 1000).toFixed(2);
}

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24)
  );

  const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

  if (diffDays === 0) return `오늘 ${time}`;
  if (diffDays === 1) return `어제 ${time}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

const TYPE_COLORS: Record<string, string> = {
  running: "#22c55e",
  street_running: "#22c55e",
  trail_running: "#22c55e",
  treadmill_running: "#22c55e",
  cycling: "#f59e0b",
  strength_training: "#60a5fa",
  fitness_equipment: "#60a5fa",
  walking: "#a78bfa",
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] ?? "#737373";
}

function ActivityIcon({ type }: { type: string }) {
  const color = getTypeColor(type);
  const isRunning = type.includes("running");

  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center"
      style={{ backgroundColor: `${color}15` }}
    >
      {isRunning ? (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="3.5" r="2" />
          <path d="M7 8.5l3 2 3-2M10 10.5v4M7 18l3-3.5 3 3.5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="14" height="12" rx="2" />
          <path d="M7 1v4M13 1v4" />
          <circle cx="10" cy="11" r="2.5" />
        </svg>
      )}
    </div>
  );
}

export default function RecentActivities({
  activities,
}: RecentActivitiesProps) {
  if (activities.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
          최근 활동
        </div>
        <div className="text-[13px] text-dim py-4 text-center">
          활동 기록 없음
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-4">
        최근 활동
      </div>
      <div className="space-y-3">
        {activities.map((a, i) => (
          <div key={a.id}>
            {i > 0 && <div className="border-t border-border mb-3" />}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ActivityIcon type={a.activityType} />
                <div>
                  <div className="text-[13px]">{a.name}</div>
                  <div className="text-[11px] text-dim">
                    {formatDate(a.startTime)} · {formatDuration(a.duration)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                {a.distance ? (
                  <>
                    <div className="text-[13px] font-[family-name:var(--font-geist-mono)]">
                      {formatDistance(a.distance)}{" "}
                      <span className="text-[11px] text-dim">km</span>
                    </div>
                    {a.avgPace && (
                      <div className="text-[11px] text-dim font-[family-name:var(--font-geist-mono)]">
                        {formatPace(a.avgPace)}
                      </div>
                    )}
                  </>
                ) : a.calories ? (
                  <div className="text-[13px] font-[family-name:var(--font-geist-mono)]">
                    {a.calories}{" "}
                    <span className="text-[11px] text-dim">kcal</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
