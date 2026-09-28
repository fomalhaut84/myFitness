// #403: 히스토리 캐시의 **프로세스 간** 무효화 신호. Next 프로세스 메모리의 version 은 봇 프로세스가 못 올리므로,
// DB 의 key-value 행 (`SystemAlertState` · weather lock 과 같은 패턴) 에 epoch 를 두고 stamp 에 합친다. 스키마 변경 없음.
import prisma from "@/lib/prisma";

export const HISTORY_CACHE_EPOCH_ALERT_TYPE = "history_cache_epoch";

/** 행이 없으면 null (첫 쓰기 전) */
export async function readHistoryCacheEpoch(): Promise<Date | null> {
  const row = await prisma.systemAlertState.findUnique({
    where: { alertType: HISTORY_CACHE_EPOCH_ALERT_TYPE },
    select: { lastAlertAt: true },
  });
  return row?.lastAlertAt ?? null;
}

/** 쓰기 경로 성공 뒤 호출 (fire-and-forget). 실패는 로그만 — 캐시는 TTL 로 자가 복구 */
export async function touchHistoryCacheEpoch(): Promise<void> {
  const now = new Date();
  try {
    await prisma.systemAlertState.upsert({
      where: { alertType: HISTORY_CACHE_EPOCH_ALERT_TYPE },
      update: { lastAlertAt: now },
      create: { alertType: HISTORY_CACHE_EPOCH_ALERT_TYPE, lastAlertAt: now },
    });
  } catch (err) {
    console.warn(`[history-cache] epoch 갱신 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
}
