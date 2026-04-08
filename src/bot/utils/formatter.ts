export function fmtDistance(meters: number | null): string {
  if (meters === null) return "—";
  return `${(meters / 1000).toFixed(2)} km`;
}

export function fmtPace(secPerKm: number | null): string {
  if (secPerKm === null) return "—";
  const totalSec = Math.round(secPerKm);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}'${sec.toString().padStart(2, "0")}"/km`;
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtSleepTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}시간 ${m}분`;
}

export function fmtTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
