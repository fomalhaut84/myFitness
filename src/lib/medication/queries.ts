// #544: 복약 조회 (prisma) — 조회와 DTO 매핑만. 계산은 순수 모듈 (period · link · timeline).
import prisma from "@/lib/prisma";
import { MEDICATION_ORDER, toMedicationDto, type MedicationDto } from "./dto";

/** 전체 — 시작일 내림차순 */
export async function listMedications(): Promise<MedicationDto[]> {
  const rows = await prisma.medication.findMany({ orderBy: MEDICATION_ORDER });
  return rows.map(toMedicationDto);
}

export async function getMedication(id: string): Promise<MedicationDto | null> {
  const row = await prisma.medication.findUnique({ where: { id } });
  return row ? toMedicationDto(row) : null;
}
