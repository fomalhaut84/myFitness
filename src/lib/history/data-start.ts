// #442 (M17-3): 지표 데이터 시작일 캡션 — `/insights` 패널 E 의 규칙 ("종료 후 심박은 2026-04 부터") 을 `/trends` 로.
// 순수 부분 (`hasDataStart` · `dataStartNote`) 과 조회 (`loadMetricDataStart`, prisma) 를 한 파일에 — 조회는 지표당 findFirst 1회.
import prisma from "@/lib/prisma";
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";
import { ymdKST } from "@/lib/garmin/utils";
import type { HistoryMetricDef } from "./metrics";

export function hasDataStart(def: HistoryMetricDef): boolean {
  return typeof def.startNote === "string";
}

/** `YYYY-MM` 을 문구에 치환. 시작일이 없으면 (데이터 0건) null — 캡션을 내지 않는다 */
export function dataStartNote(def: HistoryMetricDef, fromYm: string | null): string | null {
  if (!hasDataStart(def) || fromYm === null) return null;
  return (def.startNote as string).replace("{from}", fromYm);
}

/** 지표의 첫 데이터 월 (KST `YYYY-MM`). `startNote` 없는 지표는 조회하지 않는다 */
export async function loadMetricDataStart(def: HistoryMetricDef): Promise<string | null> {
  if (!hasDataStart(def)) return null;
  if (def.source === "activity" && def.kind === "hrr2") {
    const first = await prisma.activity.findFirst({
      where: { AND: [RUNNING_ACTIVITY_WHERE, { hrr2: { not: null } }] },
      orderBy: { startTime: "asc" },
      select: { startTime: true },
    });
    return first ? ymdKST(first.startTime).slice(0, 7) : null;
  }
  return null;
}
