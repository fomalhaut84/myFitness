/** Date → "YYYY-MM-DD" (로컬 시간 기준, UTC 변환 없음) */
export function formatDateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 미터 → km (소수점 2자리) */
export function formatDistance(meters: number): string {
  return (meters / 1000).toFixed(2);
}

/** sec/km → min'sec"/km */
export function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}'${sec.toString().padStart(2, "0")}"`;
}

/** 초 → Xh Xm 또는 Xm */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** 초 → Xm Xs */
export function formatDurationShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}분 ${s}초`;
}

/** ISO 날짜 → 상대 날짜 또는 M월 D일 */
export function formatRelativeDate(isoStr: string): string {
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
  if (diffDays < 7) return `${diffDays}일 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** ISO 날짜 → YYYY.MM.DD HH:mm */
export function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr);
  const date = `${d.getFullYear()}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getDate().toString().padStart(2, "0")}`;
  const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  return `${date} ${time}`;
}
