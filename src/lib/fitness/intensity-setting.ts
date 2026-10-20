/**
 * #570: 강도 읽기 컨텍스트 — 프로필 기준 + (자동이면) 심박 영향 복약 기간.
 * 웹 (`@/lib/prisma`) · MCP (`src/mcp/prisma`) 가 각자 클라이언트를 넘긴다.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { ymdKST } from "@/lib/garmin/utils";
import { parseIntensityBasisSetting } from "./intensity";
import type { IntensityContext } from "./intensity-select";

export async function loadIntensityContext(db: Pick<PrismaClient, "userProfile" | "medication">): Promise<IntensityContext> {
  const profile = await db.userProfile.findFirst({ select: { intensityBasis: true } });
  const setting = parseIntensityBasisSetting(profile?.intensityBasis);
  if (setting !== "auto") return { setting, hrAffectedPeriods: [] };
  const meds = await db.medication.findMany({
    where: { affectsHeartRate: true },
    select: { startDate: true, endDate: true },
  });
  return {
    setting,
    hrAffectedPeriods: meds.map((m) => ({ start: ymdKST(m.startDate), end: m.endDate ? ymdKST(m.endDate) : null })),
  };
}
