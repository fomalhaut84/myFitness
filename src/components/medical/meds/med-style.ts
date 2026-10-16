// #544: 복약 종류 · 형태 배지 색 — 처방 indigo-300 · 영양제 teal-300 · 단기 회색 (판정 amber · red · 검진 녹색과 겹치지 않게 · 디자인 노트).
import type { MedicationDto } from "@/lib/medication/dto";
import { KIND_LABEL, REGIMEN_LABEL } from "@/lib/medication/dto";

export const PILL = "rounded-full px-[7px] py-px text-[11px] whitespace-nowrap";

export function medPillClass(med: Pick<MedicationDto, "kind" | "regimen">): string {
  if (med.regimen === "short_term") return "bg-surface text-sub";
  return med.kind === "prescription" ? "bg-indigo-500/20 text-indigo-300" : "bg-teal-500/15 text-teal-300";
}

export function medPillText(med: Pick<MedicationDto, "kind" | "regimen">): string {
  return `${KIND_LABEL[med.kind]} · ${REGIMEN_LABEL[med.regimen]}`;
}

export const BAR_CLASS: Record<MedicationDto["kind"], string> = {
  prescription: "bg-indigo-300/85",
  supplement: "bg-teal-300/75",
};
