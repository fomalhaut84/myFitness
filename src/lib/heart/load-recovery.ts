// #418: 활동 1건의 종료 후 회복 곡선 — 서버 전용 (prisma). 활동 rawData 는 여기서만 읽고 클라이언트로 흘리지 않는다.
import prisma from "@/lib/prisma";
import { kstInstant } from "@/lib/history/buckets";
import { activityEndMs, parseHeartRateValues, recoveryCurve, recoveryDayKeys, type RecoveryOffsetMin } from "./recovery";

/** 서버 → 클라이언트 (직렬화 가능) */
export interface RecoveryDTO {
  /** 종료일 (·다음 날) 의 HeartRateRecord 존재 여부 — false 면 "이 날 심박 기록이 없습니다" */
  hasRecord: boolean;
  /** 종료 시각 (UTC ISO) — 표시는 `formatTimeKST` */
  endIso: string;
  points: Array<{ offsetMin: RecoveryOffsetMin; bpm: number | null }>;
  hrr2: number | null;
  drop10: number | null;
  postSamples: number;
}

export async function loadActivityRecovery(activityId: string): Promise<RecoveryDTO | null> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { startTime: true, duration: true, rawData: true },
  });
  if (!activity) return null;

  const endMs = activityEndMs(activity.startTime, activity.duration, activity.rawData);
  const endIso = new Date(endMs).toISOString();
  const rows = await prisma.heartRateRecord.findMany({
    where: { date: { in: recoveryDayKeys(endMs).map(kstInstant) } },
    select: { rawData: true },
  });
  if (rows.length === 0) return { hasRecord: false, endIso, points: [], hrr2: null, drop10: null, postSamples: 0 };

  const series = rows.flatMap((r) => {
    const raw = r.rawData !== null && typeof r.rawData === "object" ? (r.rawData as Record<string, unknown>).heartRateValues : undefined;
    return parseHeartRateValues(raw);
  });
  const curve = recoveryCurve(series, endMs);
  return {
    hasRecord: true,
    endIso,
    points: curve.points.map((p) => ({ offsetMin: p.offsetMin, bpm: p.bpm })),
    hrr2: curve.hrr2,
    drop10: curve.drop10,
    postSamples: curve.postSamples,
  };
}
