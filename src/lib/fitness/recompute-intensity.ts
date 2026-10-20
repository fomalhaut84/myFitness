/**
 * #570: 전체 활동 강도를 현재 프로필 기준으로 재계산 (rawData 만 — Garmin 호출 없음).
 * 강도 기준 설정이 바뀌면 PATCH /api/profile 이 호출한다. 실행 시점에 프로필을 다시 읽어
 * 연속 변경도 마지막 설정으로 수렴한다 (idempotent).
 */

import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { computeIntensityFromRawData, parseIntensityBasisSetting } from "./intensity";
import { sameIntensityColumns, toIntensityColumns } from "./intensity-columns";

const BATCH_SIZE = 200;

export interface RecomputeResult {
  total: number;
  updated: number;
}

// 같은 프로세스 안의 재계산은 직렬화 — 겹친 실행이 옛 기준 값을 나중에 쓰지 않게 (각 실행이 시작 시 프로필을 읽는다)
let queue: Promise<unknown> = Promise.resolve();

export function recomputeAllIntensity(): Promise<RecomputeResult> {
  const run = queue.then(runRecompute, runRecompute);
  queue = run.catch(() => undefined);
  return run;
}

async function runRecompute(): Promise<RecomputeResult> {
  const profile = await prisma.userProfile.findFirst({
    select: { lthr: true, thresholdPower: true, intensityBasis: true },
  });
  const basis = parseIntensityBasisSetting(profile?.intensityBasis);
  let total = 0;
  let updated = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.activity.findMany({
      select: {
        id: true,
        avgHR: true,
        rawData: true,
        zoneDistribution: true,
        estimatedZone: true,
        intensityScore: true,
        intensityLabel: true,
        intensityBasis: true,
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    total += rows.length;
    cursor = rows[rows.length - 1].id;

    const changed = rows.flatMap((row) => {
      const next = toIntensityColumns(
        computeIntensityFromRawData({
          rawData: row.rawData as Record<string, unknown> | null,
          avgHR: row.avgHR,
          lthr: profile?.lthr ?? null,
          basis,
          thresholdPower: profile?.thresholdPower ?? null,
        })
      );
      return sameIntensityColumns(row, next) ? [] : [{ id: row.id, next }];
    });
    if (changed.length > 0) {
      await prisma.$transaction(
        changed.map(({ id, next }) =>
          prisma.activity.update({
            where: { id },
            data: {
              ...next,
              zoneDistribution:
                next.zoneDistribution === null
                  ? Prisma.DbNull
                  : (next.zoneDistribution as unknown as Prisma.InputJsonValue),
            },
          })
        )
      );
      updated += changed.length;
    }
    if (rows.length < BATCH_SIZE) break;
  }

  return { total, updated };
}
