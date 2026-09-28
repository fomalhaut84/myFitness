import { ymdKST } from "@/lib/garmin/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Date → "YYYY-MM-DD" — **KST 벽시계** (#365: 이전엔 서버 로컬 getter 라 UTC 호스트에서 DB 의 KST 자정 date 가 전날로 찍혔다).
 * 이름은 호환을 위해 유지. 호출자는 대시보드 · 심박 페이지 (KST 자정 instant) · MCP user-profile (`parseLocalDate` 로 쓴 서버 로컬 자정 —
 * KST · UTC 호스트 어느 쪽에서 썼든 KST 로 읽으면 같은 날).
 */
export function formatDateLocal(date: Date): string {
  return ymdKST(date);
}

/** #365: `toLocaleDateString("ko-KR")` 의 KST 고정판 — 봇 · 서버 라벨은 항상 이걸로 (timeZone 없는 호출은 verify 스캔이 잡는다) */
export function formatDateKST(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", ...options });
}

/** ISO/UTC 시간을 KST(+9)로 변환하여 HH:MM 표시 */
export function formatTimeKST(isoStr: string): string {
  const d = new Date(isoStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCHours().toString().padStart(2, "0")}:${kst.getUTCMinutes().toString().padStart(2, "0")}`;
}

/** 미터 → km (소수점 2자리) */
export function formatDistance(meters: number): string {
  return (meters / 1000).toFixed(2);
}

/** sec/km → min'sec"/km (반올림으로 60초 발생 방지) */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}'${sec.toString().padStart(2, "0")}"`;
}

/** #396: 초 → `h:mm:ss` (1시간 미만은 `m:ss`). 레이스 · 개인 기록의 소요 시간 표기. */
export function formatClock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
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

/** ISO 날짜 → 상대 날짜 (오늘 · 어제 · N일 전) 또는 M월 D일 — KST 벽시계 (#365). `now` 는 테스트 주입용 */
export function formatRelativeDate(isoStr: string, now: Date = new Date()): string {
  const d = new Date(isoStr);
  const todayYmd = ymdKST(now);
  const targetYmd = ymdKST(d);
  // 두 KST 날짜를 UTC 자정으로 파싱해 뺀다 — KST 는 DST 가 없어 정수 일수
  const diffDays = Math.round((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${targetYmd}T00:00:00Z`)) / DAY_MS);
  const time = formatEpochKST(d);

  if (diffDays === 0) return `오늘 ${time}`;
  if (diffDays === 1) return `어제 ${time}`;
  if (diffDays > 1 && diffDays < 7) return `${diffDays}일 전`;
  const [, mm, dd] = targetYmd.split("-");
  return `${Number(mm)}월 ${Number(dd)}일`;
}

/** ISO 날짜 → YYYY.MM.DD HH:mm — KST 벽시계 (#365) */
export function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${ymdKST(d).replace(/-/g, ".")} ${formatEpochKST(d)}`;
}

/**
 * SpO2 표시 — 정수 % (도메인 룰: 심박수 bpm 과 동일 취급).
 *
 * #341: 봇과 웹이 각자 구현하던 것을 단일 소스로 통합. 최저값은 야간 저산소 판단의
 * 기준이라 있으면 병기한다.
 *
 * @param lowest 있으면 ` (최저 N%)` 병기
 * @param opts.fallback avg 결측 시 문구 (기본 "-")
 */
export function fmtSpO2(
  avg: number | null | undefined,
  lowest?: number | null,
  opts?: { fallback?: string },
): string {
  if (avg === null || avg === undefined || !Number.isFinite(avg)) {
    return opts?.fallback ?? "-";
  }
  const range =
    lowest !== null && lowest !== undefined && Number.isFinite(lowest)
      ? ` (최저 ${Math.round(lowest)}%)`
      : "";
  return `${Math.round(avg)}%${range}`;
}

/**
 * epoch ms(또는 Date) → KST "HH:MM".
 *
 * ⚠️ `value` 가 `number | Date` 인 이유 (#342, Codex P1): Recharts 의
 * `scale="time"` 축은 내부적으로 d3 `scaleTime` 을 쓰고, `.ticks()` 는 도메인이
 * 숫자여도 **Date 객체**를 반환한다. 이 값을 숫자로 가정하고 `value + 9h` 를 하면
 * `Date + number` 가 **문자열 결합**이 되고, 그 문자열을 다시 파싱하면 원래 instant 로
 * 돌아와 오프셋이 통째로 사라진다 → 축은 UTC, 헤더는 KST 로 9시간 어긋난다.
 * 반드시 `getTime()` 으로 정규화한 뒤 오프셋을 더한다.
 */
export function formatEpochKST(value: number | Date | string): string {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Number(value);
  if (!Number.isFinite(ms)) return "-";
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const h = String(kst.getUTCHours()).padStart(2, "0");
  const m = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
