// #547 (M18-4): 건강 기록 MCP 도구 — 검진 이력 · 항목 추이 · 복약 (read-only). 응답 조립은 health-records-view (순수).
// 판정은 기관 판정 그대로 (범위 계산은 출처 표시). 진단 · 처방 해석은 하지 않는다 (시스템 프롬프트).
import prisma from "../prisma";
import { todayKSTString, ymdKST } from "@/lib/garmin/utils";
import { getCheckupItem } from "@/lib/checkup/items";
import { countFlags, pendingFollowUps, previousResults } from "@/lib/checkup/compare";
import { sortResults, toFindings } from "@/lib/checkup/dto";
import { splitTrendByUnit } from "@/lib/checkup/view";
import { MEDICATION_ORDER, toMedicationDto, type MedicationDto } from "@/lib/medication/dto";
import { medsForCheckup, medsForItem } from "@/lib/medication/link";
import { medicationStatus } from "@/lib/medication/period";
import { DEFAULT_ROUNDS, MAX_ROUNDS, flagText, medicationView, resolveItemQuery, resultValue, suggestItems } from "./health-records-view";

function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

async function loadMedications(): Promise<MedicationDto[]> {
  const rows = await prisma.medication.findMany({ orderBy: MEDICATION_ORDER });
  return rows.map(toMedicationDto);
}

async function customLabels(): Promise<Record<string, string>> {
  const rows = await prisma.checkupResult.findMany({
    where: { itemCode: { startsWith: "custom:" } },
    distinct: ["itemCode"],
    orderBy: [{ itemCode: "asc" }, { checkup: { date: "desc" } }],
    select: { itemCode: true, label: true },
  });
  return Object.fromEntries(rows.map((r) => [r.itemCode, r.label]));
}

/** 검진에 기록된 항목 (카탈로그 · 카탈로그 밖) — code · 표시 이름 */
async function recordedItems(): Promise<{ code: string; label: string }[]> {
  const [codes, custom] = await Promise.all([
    prisma.checkupResult.findMany({ distinct: ["itemCode"], select: { itemCode: true } }),
    customLabels(),
  ]);
  return codes.map(({ itemCode }) => ({ code: itemCode, label: getCheckupItem(itemCode)?.label ?? custom[itemCode] ?? itemCode }));
}

export async function getCheckupHistory(args: { rounds?: number }) {
  const limit = Math.min(Math.max(args.rounds ?? DEFAULT_ROUNDS, 1), MAX_ROUNDS);
  const rounds = await prisma.healthCheckup.findMany({
    orderBy: { date: "desc" },
    take: limit,
    select: { id: true, date: true, institution: true, kind: true, summary: true, findings: true, results: { select: { flag: true } } },
  });
  if (rounds.length === 0) {
    return text({ _context: "검진 기록 없음. 사용자가 /medical 에서 검진 결과를 입력하거나 결과지를 가져오면 생깁니다.", rounds: [] });
  }
  const latest = rounds[0];
  const latestDate = ymdKST(latest.date);
  const latestResults = await prisma.checkupResult.findMany({ where: { checkupId: latest.id } });
  const flagged = latestResults.filter((r) => r.flag === "caution" || r.flag === "abnormal");
  const earlier = await prisma.checkupResult.findMany({
    where: { itemCode: { in: flagged.map((r) => r.itemCode) }, checkup: { date: { lt: latest.date } } },
    select: { itemCode: true, valueNum: true, valueText: true, unit: true, checkup: { select: { date: true } } },
  });
  const prev = previousResults(latestDate, flagged.map((r) => r.itemCode), earlier.map((e) => ({ ...e, date: ymdKST(e.checkup.date) })));

  const followRows = await prisma.checkupResult.findMany({
    where: { followUpDue: { not: null } },
    select: { itemCode: true, label: true, followUp: true, followUpDue: true, checkup: { select: { date: true } } },
    orderBy: { followUpDue: "asc" },
  });
  const later = followRows.length
    ? await prisma.checkupResult.findMany({
        where: { itemCode: { in: [...new Set(followRows.map((r) => r.itemCode))] } },
        select: { itemCode: true, checkup: { select: { date: true } } },
      })
    : [];
  const followUps = pendingFollowUps(
    followRows.map((r) => ({
      checkupDate: ymdKST(r.checkup.date),
      itemCode: r.itemCode,
      item: getCheckupItem(r.itemCode)?.label ?? r.label,
      recommendation: r.followUp,
      due: r.followUpDue ? ymdKST(r.followUpDue) : null,
    })),
    later.map((l) => ({ itemCode: l.itemCode, date: ymdKST(l.checkup.date) })),
  );

  return text({
    _context:
      "검진 회차 (최근 순) · 최근 회차의 주의/이상 항목 · 아직 받지 않은 추적검사. 판정은 기관 판정 그대로 (범위 계산은 표시). 항목 하나의 변화는 get_checkup_item_trend.",
    today: todayKSTString(),
    rounds: rounds.map((r) => ({
      date: ymdKST(r.date),
      institution: r.institution,
      kind: r.kind,
      resultCount: r.results.length,
      flags: countFlags(r.results),
    })),
    latest: {
      date: latestDate,
      summary: latest.summary,
      findings: toFindings(latest.findings).map((f) => `${f.category}: ${f.text}`),
      flaggedItems: sortResults(flagged).map((r) => {
        const p = prev.get(r.itemCode);
        return {
          item: getCheckupItem(r.itemCode)?.label ?? r.label,
          code: r.itemCode,
          value: resultValue(r),
          reference: r.refText,
          flag: flagText(r.flag, r.flagSource),
          previous: p ? { date: p.date, value: resultValue(p) } : null,
          note: r.note,
        };
      }),
    },
    pendingFollowUps: followUps.map(({ itemCode: _c, ...f }) => f),
  });
}

export async function getCheckupItemTrend(args: { item: string }) {
  const q = resolveItemQuery(args.item);
  if ("error" in q) return text({ error: q.error, suggestions: q.suggestions });
  const rows = await prisma.checkupResult.findMany({
    where: { itemCode: q.code },
    include: { checkup: { select: { id: true, date: true, institution: true } } },
    orderBy: { checkup: { date: "asc" } },
  });
  if (rows.length === 0) {
    // "콜레스테롤" 처럼 여러 항목에 걸친 이름 · 카탈로그 밖 항목의 일부 이름 — 기록이 있는 비슷한 항목을 알려 다시 묻게
    return text({ error: `이 항목의 검진 기록이 없습니다: ${args.item}`, code: q.code, suggestions: suggestItems(args.item, await recordedItems()) });
  }
  const meds = await loadMedications();
  const points = rows.map((r) => ({ ...r, date: ymdKST(r.checkup.date) }));
  const { excluded } = splitTrendByUnit(points);
  const item = getCheckupItem(q.code);
  return text({
    _context:
      "회차별 값 (오래된 순) · 그때 먹던 약 (장기 = 이 항목과 연결한 약 · 단기 = 검진일 앞 14일 안). 단위가 다른 회차는 값을 직접 비교하지 않는다.",
    item: item?.label ?? rows[rows.length - 1].label,
    code: q.code,
    unitWarning: excluded > 0 ? `단위가 다른 회차 ${excluded}개 — 직접 비교 금지` : null,
    points: points.map((p) => ({
      date: p.date,
      institution: p.checkup.institution,
      value: resultValue(p),
      reference: p.refText,
      flag: flagText(p.flag, p.flagSource),
      medicationsAtCheckup: medsForCheckup(meds, q.code, p.date).map((m) =>
        m.endedDaysBefore === null ? m.name : `${m.name} (단기 · ${m.endedDaysBefore === 0 ? "검진일 복용" : `${m.endedDaysBefore}일 전까지`})`,
      ),
    })),
    relatedMedications: medsForItem(meds, q.code).map((m) => `${m.name} ${m.startDate} ~ ${m.endDate ?? "복용 중"}`),
  });
}

export async function getMedications(args: { status?: "active" | "all" }) {
  const today = todayKSTString();
  const [meds, labels] = await Promise.all([loadMedications(), customLabels()]);
  const list = args.status === "all" ? meds : meds.filter((m) => medicationStatus(m, today) === "active");
  if (list.length === 0) {
    return text({
      _context: args.status === "all" ? "복약 기록 없음." : "지금 복용 중인 약 · 영양제 없음 (status=all 로 지난 복약 조회).",
      medications: [],
    });
  }
  return text({
    _context: "복약 기록 (시작일 최근 순). 장기 = 꾸준히 복용 · 단기 = 감기약처럼 짧게. 약 변경 · 복용 조언은 하지 않는다 (의사와 상의).",
    today,
    medications: list.map((m) => medicationView(m, today, labels)),
  });
}
