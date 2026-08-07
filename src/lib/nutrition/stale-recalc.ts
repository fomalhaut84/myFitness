// #283 (Codex P2): recalculateCalorieBalance 가 transient 실패한 date 큐.
//
// 원자성 요구사항 (Codex P2):
//  1) 두 producer 가 다른 KST-day 를 동시에 mark 해도 소실 없음
//  2) drain → recalc 사이 프로세스가 크래시해도 미처리 date 손실 없음
//
// 구현: 스키마 신규 모델 도입 없이 SystemAlertState 를 per-date row 로 사용.
//   alertType = "food_stale_recalc:YYYY-MM-DD" (KST 기준)
//   - mark: upsert (create) — unique 위반은 무해 (동일 date 중복 mark 방지)
//   - list: findMany where startsWith
//   - ack: 성공 후 개별 delete (소실 방지 = drain 후 leave-in-place, 성공만 삭제)

import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";

const ALERT_PREFIX = "food_stale_recalc:";

/** KST 기준 YYYY-MM-DD (예: 2026-08-07). */
function toDayKey(date: Date): string {
  return ymdKST(date);
}

function toAlertType(dayKey: string): string {
  return `${ALERT_PREFIX}${dayKey}`;
}

/** date 를 큐에 mark. 이미 있으면 no-op (idempotent). */
export async function markStaleRecalcDate(date: Date): Promise<void> {
  const dayKey = toDayKey(date);
  const alertType = toAlertType(dayKey);
  const now = new Date();
  await prisma.systemAlertState.upsert({
    where: { alertType },
    create: { alertType, lastAlertAt: now, lastErrorMsg: dayKey },
    update: { lastAlertAt: now },
  });
}

/** Claim = 처리 시점 스냅샷 (date + claimedAt). ack 는 이 timestamp 보다 오래된 row 만 삭제. */
export interface StaleRecalcClaim {
  date: Date;
  claimedAt: Date;
}

/**
 * 큐에 남은 date 를 claim 형태로 반환. **삭제하지 않는다** — 각 claim 은 recalc 성공 후
 * ackStaleRecalcClaim 로 조건부 확인. 프로세스 중단 시에도 미처리 date 손실 없음.
 * Codex P2 (#283): claim 이후 새로 upsert 된 mark 는 lastAlertAt 이 갱신되므로
 * ack 시 조건 (lastAlertAt <= claimedAt) 을 붙여 새 signal 을 실수로 지우지 않게.
 */
export async function listStaleRecalcDates(): Promise<StaleRecalcClaim[]> {
  const rows = await prisma.systemAlertState.findMany({
    where: { alertType: { startsWith: ALERT_PREFIX } },
    select: { alertType: true, lastAlertAt: true },
    orderBy: { lastAlertAt: "asc" },
  });
  const claims: StaleRecalcClaim[] = [];
  for (const r of rows) {
    const k = r.alertType.slice(ALERT_PREFIX.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    claims.push({ date: new Date(`${k}T00:00:00+09:00`), claimedAt: r.lastAlertAt });
  }
  return claims;
}

/**
 * recalc 성공한 claim 을 큐에서 제거. lastAlertAt 이 claimedAt 이하인 경우만.
 * 즉 처리 중 다른 producer 가 새로 mark (upsert 로 lastAlertAt 갱신) 한 row 는 건드리지 않음.
 * 반환값: 실제 삭제된 row 수 (0 이면 새 mark 로 인해 skip 됨 = 다음 tick 이 새 signal 처리).
 */
export async function ackStaleRecalcClaim(claim: StaleRecalcClaim): Promise<number> {
  const alertType = toAlertType(toDayKey(claim.date));
  const result = await prisma.systemAlertState.deleteMany({
    where: { alertType, lastAlertAt: { lte: claim.claimedAt } },
  });
  return result.count;
}
