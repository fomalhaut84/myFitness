/**
 * #570: 러닝 파워 기준 강도가 비어 있는 활동을 rawData 로 채운다 (Garmin 호출 없음).
 * 심박 기준 컬럼은 건드리지 않는다. 대상 = 러닝 계열 · 파워 컬럼 null · rawData 에 파워 존 시간이 있는 활동.
 * 싱크 끝 (syncActivities · syncUserProfile) · scripts/backfill-intensity.ts 가 부른다. 반복 실행해도 안전 (채운 행은 다시 대상이 아니다).
 * 역치파워가 아직 없으면 채우지 않는다 — 일일 싱크는 activities 가 user_profile 보다 먼저라, 배포 첫날 보정 없는 값이
 * 굳지 않게 프로필 싱크가 역치파워를 받은 뒤 채운다.
 */

import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";
import { computePowerIntensityFromRawData } from "./intensity";
import { toPowerColumns } from "./intensity-select";

const BATCH_SIZE = 200;

export interface PowerFillResult {
  scanned: number;
  filled: number;
}

export async function fillMissingPowerIntensity(): Promise<PowerFillResult> {
  const profile = await prisma.userProfile.findFirst({ select: { thresholdPower: true } });
  const thresholdPower = profile?.thresholdPower ?? null;
  if (thresholdPower === null) return { scanned: 0, filled: 0 };
  let scanned = 0;
  let filled = 0;
  let lastId: string | undefined;

  for (;;) {
    // 커서는 id > 마지막 id 로 — Prisma cursor + skip 1 은 방금 채워 필터에서 빠진 행을 기준으로 다음 행 하나를
    // 건너뛰었다 (사전 리뷰 major 2: 배치마다 1행 누락)
    const rows = await prisma.activity.findMany({
      where: {
        AND: [
          RUNNING_ACTIVITY_WHERE,
          { powerZoneDistribution: { equals: Prisma.DbNull } },
          { rawData: { path: ["powerTimeInZone_1"], gte: 0 } },
          ...(lastId ? [{ id: { gt: lastId } }] : []),
        ],
      },
      select: { id: true, activityType: true, rawData: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) break;
    scanned += rows.length;
    lastId = rows[rows.length - 1].id;

    const updates = rows.flatMap((row) => {
      const intensity = computePowerIntensityFromRawData({
        rawData: row.rawData as Record<string, unknown> | null,
        activityType: row.activityType,
        thresholdPower,
      });
      return intensity ? [{ id: row.id, intensity }] : [];
    });
    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map(({ id, intensity }) =>
          prisma.activity.update({
            where: { id },
            data: {
              ...toPowerColumns(intensity),
              powerZoneDistribution: intensity.zoneDistribution as unknown as Prisma.InputJsonValue,
            },
          })
        )
      );
      filled += updates.length;
    }
    if (rows.length < BATCH_SIZE) break;
  }

  return { scanned, filled };
}
