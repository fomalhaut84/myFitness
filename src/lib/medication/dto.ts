// #544: 복약 응답 형태 (API · 서버 컴포넌트 · 클라이언트 공용). 날짜는 KST "YYYY-MM-DD". 순수 타입.
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
}

export const KIND_LABEL: Record<MedicationKind, string> = { prescription: "처방", supplement: "영양제" };
export const REGIMEN_LABEL: Record<MedicationRegimen, string> = { long_term: "장기", short_term: "단기" };
