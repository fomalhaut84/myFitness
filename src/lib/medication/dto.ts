// #544: 복약 응답 형태 (API · 서버 컴포넌트 · 클라이언트 공용). 날짜는 KST "YYYY-MM-DD". 순수 타입.
import { ymdKST } from "@/lib/garmin/utils";
import type { MedicationKind, MedicationRegimen } from "./schema";

export interface MedicationDto {
  id: string;
  name: string;
  kind: MedicationKind;
  regimen: MedicationRegimen;
  ingredient: string | null;
  dose: string | null;
  frequency: string | null;
  startDate: string;
  endDate: string | null;
  purpose: string | null;
  prescriber: string | null;
  note: string | null;
  relatedItems: string[];
  /** #570: 심박 반응에 영향 (강도 기준 "자동" 판단 근거) */
  affectsHeartRate: boolean;
}

/** DB 행 → DTO (앱 · MCP 공용 — MCP 는 자기 prisma 를 쓰므로 조회는 따로, 매핑은 여기 하나) */
export function toMedicationDto(r: {
  id: string;
  name: string;
  kind: string;
  regimen: string;
  ingredient: string | null;
  dose: string | null;
  frequency: string | null;
  startDate: Date;
  endDate: Date | null;
  purpose: string | null;
  prescriber: string | null;
  note: string | null;
  relatedItems: string[];
  affectsHeartRate: boolean;
}): MedicationDto {
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
    affectsHeartRate: r.affectsHeartRate,
  };
}

/** 시작일 최근 순 · 같은 날은 최근 입력 순 (앱 · MCP 공용) */
export const MEDICATION_ORDER = [{ startDate: "desc" as const }, { createdAt: "desc" as const }];

export const KIND_LABEL: Record<MedicationKind, string> = { prescription: "처방", supplement: "영양제" };
export const REGIMEN_LABEL: Record<MedicationRegimen, string> = { long_term: "장기", short_term: "단기" };
