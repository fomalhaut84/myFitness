// #544: 복약 폼 상태 ↔ API 입력. 단기는 "N일분" 또는 종료일 직접. 순수.
import type { MedicationDto } from "./dto";
import { MAX_COURSE_DAYS, courseDays, endFromDays } from "./period";
import type { MedicationInputBody, MedicationKind, MedicationRegimen } from "./schema";

export type EndMode = "days" | "date";

export interface MedFormState {
  name: string;
  kind: MedicationKind;
  regimen: MedicationRegimen;
  ingredient: string;
  dose: string;
  frequency: string;
  startDate: string;
  /** 장기: 비우면 복용 중 · 단기 + date 모드: 종료일 */
  endDate: string;
  endMode: EndMode;
  days: string;
  purpose: string;
  prescriber: string;
  note: string;
  relatedItems: string[];
}

/** 종류에 따른 복용 형태 기본값 — 처방약은 단기, 영양제는 장기 (스펙 §2-5) */
export function defaultRegimen(kind: MedicationKind): MedicationRegimen {
  return kind === "prescription" ? "short_term" : "long_term";
}

export function emptyMedForm(todayYmd: string): MedFormState {
  return {
    name: "",
    kind: "prescription",
    regimen: "short_term",
    ingredient: "",
    dose: "",
    frequency: "",
    startDate: todayYmd,
    endDate: "",
    endMode: "days",
    days: "",
    purpose: "",
    prescriber: "",
    note: "",
    relatedItems: [],
  };
}

export function medFormFromDto(dto: MedicationDto): MedFormState {
  return {
    name: dto.name,
    kind: dto.kind,
    regimen: dto.regimen,
    ingredient: dto.ingredient ?? "",
    dose: dto.dose ?? "",
    frequency: dto.frequency ?? "",
    startDate: dto.startDate,
    endDate: dto.endDate ?? "",
    endMode: "date",
    days: "",
    purpose: dto.purpose ?? "",
    prescriber: dto.prescriber ?? "",
    note: dto.note ?? "",
    relatedItems: dto.relatedItems,
  };
}

/** 다시 시작 — 같은 내용 · 시작일 오늘. 장기는 복용 중, 단기는 같은 일수 */
export function restartFrom(dto: MedicationDto, todayYmd: string): MedFormState {
  const base = { ...medFormFromDto(dto), startDate: todayYmd, endDate: "" };
  if (dto.regimen === "short_term" && dto.endDate) {
    const days = courseDays(dto.startDate, dto.endDate);
    // N일분 입력은 365 까지 — 더 길면 종료일 직접 입력으로 (PR 전 리뷰 info 1)
    return days <= MAX_COURSE_DAYS ? { ...base, endMode: "days", days: String(days) } : base;
  }
  return base;
}

/** 저장할 종료일 — 장기: 입력값 (빈칸 = 복용 중) · 단기: N일분 또는 날짜 */
export function resolvedEndDate(state: MedFormState): string | null {
  if (state.regimen === "short_term" && state.endMode === "days") {
    return state.days.trim() === "" ? null : endFromDays(state.startDate, Number(state.days));
  }
  return state.endDate === "" ? null : state.endDate;
}

export function medFormToInput(state: MedFormState): MedicationInputBody {
  return {
    name: state.name,
    kind: state.kind,
    regimen: state.regimen,
    ingredient: state.ingredient,
    dose: state.dose,
    frequency: state.frequency,
    startDate: state.startDate,
    endDate: resolvedEndDate(state),
    purpose: state.purpose,
    prescriber: state.prescriber,
    note: state.note,
    relatedItems: state.relatedItems,
  };
}
