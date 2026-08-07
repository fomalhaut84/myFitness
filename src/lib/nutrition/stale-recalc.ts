// #283 (Codex P2): recalculateCalorieBalance 가 transient 실패한 date 들을 저장해두는 큐.
// - `/food_kcal` 봇 명령, backfill 스크립트 등 여러 경로에서 실패 시 여기에 date 를 mark.
// - cron 이 매 tick 이 큐를 읽어 재시도 → 성공하면 date 제거.
// - 스키마 신규 모델 없이 SystemAlertState 를 재활용:
//     alertType="food_stale_recalc"
//     lastErrorMsg  → JSON.stringify(sorted string[] of ISO dates)
//   단일 사용자 앱이라 큐 사이즈는 매우 작음 (~수십 date 이하).

import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";

const ALERT_TYPE = "food_stale_recalc";
// lastErrorMsg 는 200자 제한 (SystemAlertState 주석). 한 date=10자 → 안전 여유 15개.
// 15개 초과 시 오래된 것부터 밀어냄 (FIFO). 실제 운영에서 이 이상 쌓이면 서비스가 정말 병들어있음.
const MAX_QUEUE = 15;

/**
 * KST 기준 YYYY-MM-DD key 로 정규화.
 * Codex P2 (#283): 이전 toISOString().slice(0,10) 은 UTC 날짜라 KST 00:00~08:59 log 의 date
 * 를 전날로 잘못 저장 → cron 이 잘못된 date 를 재계산하고 큐에서 제거 → intended DailySummary
 * 는 영영 stale.
 */
function toDayKey(date: Date): string {
  return ymdKST(date);
}

async function readQueue(): Promise<string[]> {
  const row = await prisma.systemAlertState.findUnique({
    where: { alertType: ALERT_TYPE },
    select: { lastErrorMsg: true },
  });
  if (!row?.lastErrorMsg) return [];
  try {
    const parsed = JSON.parse(row.lastErrorMsg);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function writeQueue(dayKeys: string[]): Promise<void> {
  const trimmed = dayKeys.slice(-MAX_QUEUE);
  const body = JSON.stringify(trimmed);
  const now = new Date();
  await prisma.systemAlertState.upsert({
    where: { alertType: ALERT_TYPE },
    create: { alertType: ALERT_TYPE, lastAlertAt: now, lastErrorMsg: body },
    update: { lastAlertAt: now, lastErrorMsg: body },
  });
}

export async function markStaleRecalcDate(date: Date): Promise<void> {
  const key = toDayKey(date);
  const existing = await readQueue();
  if (existing.includes(key)) return;
  await writeQueue([...existing, key]);
}

/** cron 이 호출: 큐 전체를 반환 + 초기화. 성공 처리는 호출자 책임.
 *  반환 Date 는 각 KST-day 안에 위치한 UTC instant (KST 00:00) — recalculateCalorieBalance 가
 *  내부 ymdKST(date) 로 다시 원래 KST-day 를 복원해 정합. */
export async function drainStaleRecalcQueue(): Promise<Date[]> {
  const existing = await readQueue();
  if (existing.length === 0) return [];
  await writeQueue([]);
  return existing.map((k) => new Date(`${k}T00:00:00+09:00`));
}
