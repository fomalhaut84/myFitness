import Link from "next/link";
import {
  formatDistance,
  formatPace,
  formatDuration,
  formatRelativeDate,
} from "@/lib/format";

interface ActivityCardProps {
  id: string;
  name: string;
  activityType: string;
  startTime: string;
  duration: number;
  distance: number | null;
  avgPace: number | null;
  avgHR: number | null;
  calories: number | null;
}

const TYPE_LABELS: Record<string, string> = {
  running: "러닝",
  street_running: "러닝",
  trail_running: "트레일 러닝",
  treadmill_running: "트레드밀",
  cycling: "사이클링",
  strength_training: "근력",
  fitness_equipment: "헬스",
  walking: "걷기",
};

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

export default function ActivityCard(props: ActivityCardProps) {
  const color = TYPE_COLORS[props.activityType] ?? "#737373";
  const typeLabel = TYPE_LABELS[props.activityType] ?? props.activityType;

  return (
    <Link
      href={`/activities/${props.id}`}
      className="block bg-card border border-border rounded-xl p-4 hover:border-border-hover transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-[11px] tracking-wider uppercase" style={{ color }}>
            {typeLabel}
          </span>
        </div>
        <span className="text-[11px] text-dim">
          {formatRelativeDate(props.startTime)}
        </span>
      </div>

      <div className="text-[15px] font-medium mb-3">{props.name}</div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        {props.distance !== null && props.distance > 0 && (
          <div>
            <span className="font-[family-name:var(--font-geist-mono)]">
              {formatDistance(props.distance)}
            </span>
            <span className="text-dim ml-1">km</span>
          </div>
        )}
        <div>
          <span className="font-[family-name:var(--font-geist-mono)]">
            {formatDuration(props.duration)}
          </span>
        </div>
        {props.avgPace !== null && (
          <div>
            <span className="font-[family-name:var(--font-geist-mono)]">
              {formatPace(props.avgPace)}
            </span>
            <span className="text-dim ml-1">/km</span>
          </div>
        )}
        {props.avgHR !== null && (
          <div>
            <span className="font-[family-name:var(--font-geist-mono)]">
              {props.avgHR}
            </span>
            <span className="text-dim ml-1">bpm</span>
          </div>
        )}
        {props.calories !== null && (
          <div>
            <span className="font-[family-name:var(--font-geist-mono)]">
              {props.calories}
            </span>
            <span className="text-dim ml-1">kcal</span>
          </div>
        )}
      </div>
    </Link>
  );
}
