// #527: 검진 조회 (prisma). 응답 형태 · 정렬 · 비교는 순수 모듈 (dto · compare) — 이 파일은 조회와 매핑만.
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { getCheckupItem } from "./items";
import { countFlags, previousResults } from "./compare";
import {
  sortResults,
  toFindings,
  type CheckupDetailDto,
  type CheckupSummaryDto,
  type FollowUpDto,
  type ItemTrendDto,
} from "./dto";

export async function listCheckups(): Promise<CheckupSummaryDto[]> {
  const rows = await prisma.healthCheckup.findMany({
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      institution: true,
      kind: true,
      source: true,
      results: { select: { flag: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    date: ymdKST(r.date),
    institution: r.institution,
    kind: r.kind,
    source: r.source,
    resultCount: r.results.length,
    counts: countFlags(r.results),
  }));
}

export async function getCheckupDetail(id: string): Promise<CheckupDetailDto | null> {
  const checkup = await prisma.healthCheckup.findUnique({ where: { id }, include: { results: true } });
  if (!checkup) return null;

  const date = ymdKST(checkup.date);
  const codes = checkup.results.map((r) => r.itemCode);
  const earlier = await prisma.checkupResult.findMany({
    where: { itemCode: { in: codes }, checkup: { date: { lt: checkup.date } } },
    select: { itemCode: true, valueNum: true, valueText: true, unit: true, flag: true, checkup: { select: { date: true } } },
  });
  const prev = previousResults(
    date,
    codes,
    earlier.map((e) => ({ ...e, date: ymdKST(e.checkup.date) })),
  );

  const results = checkup.results.map((r) => {
    const p = prev.get(r.itemCode);
    return {
      id: r.id,
      itemCode: r.itemCode,
      label: r.label,
      category: r.category,
      valueNum: r.valueNum,
      valueText: r.valueText,
      unit: r.unit,
      refText: r.refText,
      refLow: r.refLow,
      refHigh: r.refHigh,
      flag: r.flag,
      flagSource: r.flagSource,
      note: r.note,
      followUp: r.followUp,
      followUpDue: r.followUpDue ? ymdKST(r.followUpDue) : null,
      previous: p ? { date: p.date, valueNum: p.valueNum, valueText: p.valueText, unit: p.unit, flag: p.flag } : null,
    };
  });

  return {
    id: checkup.id,
    date,
    institution: checkup.institution,
    kind: checkup.kind,
    source: checkup.source,
    resultCount: results.length,
    counts: countFlags(results),
    summary: checkup.summary,
    findings: toFindings(checkup.findings),
    results: sortResults(results),
  };
}

/** 항목 추이 — 회차 오름차순. 결과가 하나도 없으면 null. */
export async function getItemTrend(itemCode: string): Promise<ItemTrendDto | null> {
  const rows = await prisma.checkupResult.findMany({
    where: { itemCode },
    include: { checkup: { select: { id: true, date: true, institution: true } } },
    orderBy: { checkup: { date: "asc" } },
  });
  if (rows.length === 0) return null;
  const item = getCheckupItem(itemCode);
  const latest = rows[rows.length - 1];
  return {
    itemCode,
    label: item?.label ?? latest.label,
    category: item?.category ?? latest.category,
    unit: item?.unit ?? latest.unit,
    points: rows.map((r) => ({
      checkupId: r.checkup.id,
      date: ymdKST(r.checkup.date),
      institution: r.checkup.institution,
      valueNum: r.valueNum,
      valueText: r.valueText,
      unit: r.unit,
      refText: r.refText,
      refLow: r.refLow,
      refHigh: r.refHigh,
      flag: r.flag,
    })),
  };
}

/** 추적검사 권고 — 예정일 오름차순 (지난 것 포함 · 화면이 강조). */
export async function listFollowUps(): Promise<FollowUpDto[]> {
  const rows = await prisma.checkupResult.findMany({
    where: { followUpDue: { not: null } },
    select: {
      itemCode: true,
      label: true,
      followUp: true,
      followUpDue: true,
      checkup: { select: { id: true, date: true } },
    },
    orderBy: { followUpDue: "asc" },
  });
  return rows.flatMap((r) =>
    r.followUpDue
      ? [
          {
            checkupId: r.checkup.id,
            checkupDate: ymdKST(r.checkup.date),
            itemCode: r.itemCode,
            label: getCheckupItem(r.itemCode)?.label ?? r.label,
            followUp: r.followUp,
            followUpDue: ymdKST(r.followUpDue),
          },
        ]
      : [],
  );
}
