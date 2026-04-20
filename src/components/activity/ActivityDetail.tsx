import {
  formatDistance,
  formatPace,
  formatDuration,
  formatDateTime,
} from "@/lib/format";

interface ActivityDetailProps {
  name: string;
  activityType: string;
  startTime: string;
  duration: number;
  distance: number | null;
  calories: number | null;
  avgHR: number | null;
  maxHR: number | null;
  avgPace: number | null;
  avgSpeed: number | null;
  elevationGain: number | null;
  trainingEffect: number | null;
  vo2maxEstimate: number | null;
}

interface StatProps {
  label: string;
  value: string;
  unit?: string;
}

function Stat({ label, value, unit }: StatProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[11px] text-dim tracking-wider uppercase mb-2">
        {label}
      </div>
      <div className="text-xl font-semibold font-[family-name:var(--font-geist-mono)] tracking-tight">
        {value}
        {unit && (
          <span className="text-sm text-dim font-normal ml-1">{unit}</span>
        )}
      </div>
    </div>
  );
}

export default function ActivityDetail(props: ActivityDetailProps) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">{props.name}</h1>
        <p className="text-dim text-sm">{formatDateTime(props.startTime)}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {props.distance !== null && props.distance > 0 && (
          <Stat label="거리" value={formatDistance(props.distance)} unit="km" />
        )}
        <Stat label="시간" value={formatDuration(props.duration)} />
        {props.avgPace !== null && (
          <Stat label="평균 페이스" value={formatPace(props.avgPace)} unit="/km" />
        )}
        {props.calories !== null && (
          <Stat label="칼로리" value={props.calories.toLocaleString("ko-KR")} unit="kcal" />
        )}
        {props.avgHR !== null && (
          <Stat label="평균 심박" value={String(props.avgHR)} unit="bpm" />
        )}
        {props.maxHR !== null && (
          <Stat label="최대 심박" value={String(props.maxHR)} unit="bpm" />
        )}
        {props.elevationGain !== null && props.elevationGain > 0 && (
          <Stat label="고도 상승" value={String(Math.round(props.elevationGain))} unit="m" />
        )}
        {props.trainingEffect !== null && (
          <Stat label="트레이닝 이펙트" value={props.trainingEffect.toFixed(1)} />
        )}
        {props.vo2maxEstimate !== null && (
          <Stat label="VO2max" value={props.vo2maxEstimate.toFixed(1)} />
        )}
        {props.avgSpeed !== null && (
          <Stat label="평균 속도" value={props.avgSpeed.toFixed(1)} unit="km/h" />
        )}
      </div>
    </div>
  );
}
