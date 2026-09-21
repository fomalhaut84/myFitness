// #394 (M15-2): `/history` 3 레벨 페이지 공용 — 컨텍스트 (오늘 · 캐시된 하한) 로드 + 라우트 검증/redirect.
import { redirect } from "next/navigation";
import { todayKSTString } from "@/lib/garmin/utils";
import { getCachedLowerBound } from "@/lib/history/cache";
import { parseHistoryRoute, type HistoryRoute } from "@/lib/history/route-params";
import type { HistoryViewContext } from "@/lib/history/view";

export interface ResolvedHistoryRoute<L extends HistoryRoute["level"]> {
  route: Extract<HistoryRoute, { level: L }>;
  ctx: HistoryViewContext;
}

export async function resolveHistoryRoute<L extends HistoryRoute["level"]>(
  level: L,
  segments: { year: string; month?: string; day?: string },
): Promise<ResolvedHistoryRoute<L>> {
  const ctx: HistoryViewContext = { today: todayKSTString(), lowerBound: await getCachedLowerBound() };
  const parsed = parseHistoryRoute(segments, ctx);
  if (!parsed.ok) redirect(parsed.redirectTo);
  if (parsed.route.level !== level) throw new Error(`히스토리 라우트 레벨 불일치: ${parsed.route.level} ≠ ${level}`);
  return { route: parsed.route as Extract<HistoryRoute, { level: L }>, ctx };
}
