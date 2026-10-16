// #544: 복약 저장 (prisma). 로그에 약 이름 · 용량을 남기지 않는다 — 에러는 checkup/write 의 describeError 로 종류 · 코드만.
import prisma from "@/lib/prisma";
import { parseDateOnlyKST } from "@/lib/date-input";
import { ymdKST } from "@/lib/garmin/utils";
import { endTodayDecision } from "./period";
import type { MedicationInput } from "./schema";

function data(input: MedicationInput) {
  return {
    name: input.name,
    kind: input.kind,
    regimen: input.regimen,
    ingredient: input.ingredient ?? null,
    dose: input.dose ?? null,
    frequency: input.frequency ?? null,
    startDate: parseDateOnlyKST(input.startDate),
    endDate: input.endDate ? parseDateOnlyKST(input.endDate) : null,
    purpose: input.purpose ?? null,
    prescriber: input.prescriber ?? null,
    note: input.note ?? null,
    relatedItems: input.relatedItems,
  };
}

export async function createMedication(input: MedicationInput): Promise<{ id: string }> {
  return prisma.medication.create({ data: data(input), select: { id: true } });
}

/** 없는 id 는 P2025 */
export async function updateMedication(id: string, input: MedicationInput): Promise<{ id: string }> {
  return prisma.medication.update({ where: { id }, data: data(input), select: { id: true } });
}

export async function deleteMedication(id: string): Promise<void> {
  await prisma.medication.delete({ where: { id } });
}

export type EndResult = "ended" | "not_found" | "already_ended" | "not_started";

/** 오늘 종료 — 판정은 endTodayDecision (종료일 = 오늘은 다시 써도 같은 값) */
export async function endMedicationToday(id: string, todayYmd: string): Promise<EndResult> {
  const med = await prisma.medication.findUnique({ where: { id }, select: { startDate: true, endDate: true } });
  if (!med) return "not_found";
  const decision = endTodayDecision({ startDate: ymdKST(med.startDate), endDate: med.endDate ? ymdKST(med.endDate) : null }, todayYmd);
  if (decision !== "end") return decision;
  await prisma.medication.update({ where: { id }, data: { endDate: parseDateOnlyKST(todayYmd) } });
  return "ended";
}
