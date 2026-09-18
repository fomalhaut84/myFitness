/**
 * #393 (M15-1): `/api/activities` · `/api/export` 공용 `from` / `to` 파라미터 (KST 달력일 inclusive).
 * 순수. 하나만 줘도 되고, 둘 다 없으면 필터 없음 (기존 동작).
 */
import { isValidYmd, kstDayRange } from "./buckets";

export type RangeParseResult =
  | { ok: true; where: { gte?: Date; lt?: Date } | null; from: string | null; to: string | null }
  | { ok: false; error: string };

export function parseYmdRangeParams(from: string | null | undefined, to: string | null | undefined): RangeParseResult {
  const f = from && from !== "" ? from : null;
  const t = to && to !== "" ? to : null;
  if (f !== null && !isValidYmd(f)) return { ok: false, error: "from 은 YYYY-MM-DD 형식의 실존 날짜여야 합니다" };
  if (t !== null && !isValidYmd(t)) return { ok: false, error: "to 는 YYYY-MM-DD 형식의 실존 날짜여야 합니다" };
  if (f !== null && t !== null && f > t) return { ok: false, error: `from(${f}) 이 to(${t}) 보다 뒤입니다` };
  if (f === null && t === null) return { ok: true, where: null, from: null, to: null };
  return {
    ok: true,
    where: {
      ...(f !== null ? { gte: kstDayRange(f).start } : {}),
      ...(t !== null ? { lt: kstDayRange(t).end } : {}),
    },
    from: f,
    to: t,
  };
}
