// #394 (M15-2): `/history` 3 레벨 페이지 공용 — 컨텍스트 (오늘 · 캐시된 하한) 로드 + 라우트 검증/redirect.
import { redirect } from "next/navigation";
import { todayKSTString } from "@/lib/garmin/utils";
import { effectiveLowerBound } from "@/lib/history/bounds";
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
  // #405 (PR #479 Codex P2): 라우팅 · 데이터 로딩 · 커버리지 · 내비가 같은 하한을 쓰도록 ctx 자체를 정규화해 돌려준다
  // (today 를 잡은 뒤 자정을 넘겨 캐시된 하한이 미래가 되는 경우 — 파서만 정규화하면 뷰가 빈 버킷을 그린다)
  const today = todayKSTString();
  const ctx: HistoryViewContext = { today, lowerBound: effectiveLowerBound(await getCachedLowerBound(), today) };
  const parsed = parseHistoryRoute(segments, ctx);
  if (!parsed.ok) redirect(parsed.redirectTo);
  if (parsed.route.level !== level) throw new Error(`히스토리 라우트 레벨 불일치: ${parsed.route.level} ≠ ${level}`);
  return { route: parsed.route as Extract<HistoryRoute, { level: L }>, ctx };
}
