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

/**
 * 큐에 남은 date 를 반환. **삭제하지 않는다** — 각 date 는 recalc 성공 후
 * ackStaleRecalcDate 로 개별 확인. 프로세스 중단 시에도 미처리 date 손실 없음.
 */
export async function listStaleRecalcDates(): Promise<Date[]> {
  const rows = await prisma.systemAlertState.findMany({
    where: { alertType: { startsWith: ALERT_PREFIX } },
    select: { alertType: true },
    orderBy: { lastAlertAt: "asc" },
  });
  return rows
    .map((r) => r.alertType.slice(ALERT_PREFIX.length))
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .map((k) => new Date(`${k}T00:00:00+09:00`));
}

/** recalc 성공한 date 를 큐에서 제거. */
export async function ackStaleRecalcDate(date: Date): Promise<void> {
  const alertType = toAlertType(toDayKey(date));
  await prisma.systemAlertState.deleteMany({ where: { alertType } });
}
