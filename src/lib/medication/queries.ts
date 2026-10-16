// #544: 복약 조회 (prisma) — 조회와 DTO 매핑만. 계산은 순수 모듈 (period · link · timeline).
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import type { MedicationDto } from "./dto";
import type { MedicationKind, MedicationRegimen } from "./schema";

type Row = Awaited<ReturnType<typeof prisma.medication.findMany>>[number];

function toDto(r: Row): MedicationDto {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as MedicationKind,
    regimen: r.regimen as MedicationRegimen,
    ingredient: r.ingredient,
    dose: r.dose,
    frequency: r.frequency,
    startDate: ymdKST(r.startDate),
    endDate: r.endDate ? ymdKST(r.endDate) : null,
    purpose: r.purpose,
    prescriber: r.prescriber,
    note: r.note,
    relatedItems: r.relatedItems,
  };
}

/** 전체 — 시작일 내림차순 */
export async function listMedications(): Promise<MedicationDto[]> {
  const rows = await prisma.medication.findMany({ orderBy: [{ startDate: "desc" }, { createdAt: "desc" }] });
  return rows.map(toDto);
}

export async function getMedication(id: string): Promise<MedicationDto | null> {
  const row = await prisma.medication.findUnique({ where: { id } });
  return row ? toDto(row) : null;
}
