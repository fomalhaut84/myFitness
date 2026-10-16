// #544: 검진 ↔ 복약 연결 (스펙 §2-4). 장기 복용은 지정한 관련 항목 + 검진일이 기간 안, 단기 복용은 관련 항목과
// 무관하게 검진일 앞 14일 안에 먹었으면. 차트 음영은 하지 않는다 (x 축이 회차 순서). 순수.
import { addDaysYmd, diffDaysYmd } from "@/lib/history/buckets";
import type { MedicationDto } from "./dto";

export const SHORT_TERM_LOOKBACK_DAYS = 14;

export interface CheckupMedication {
  id: string;
  name: string;
  kind: MedicationDto["kind"];
  regimen: MedicationDto["regimen"];
  /** 단기 복용: 검진일 며칠 전에 끝났나 (0 = 검진일에도 복용) · 장기는 null */
  endedDaysBefore: number | null;
}

function covers(med: MedicationDto, dateYmd: string): boolean {
  return med.startDate <= dateYmd && (med.endDate === null || med.endDate >= dateYmd);
}

/** 검진일에 함께 볼 약 — 장기 먼저 (이름순), 단기는 검진일에 가까운 순 */
export function medsForCheckup(meds: readonly MedicationDto[], itemCode: string, checkupYmd: string): CheckupMedication[] {
  const windowStart = addDaysYmd(checkupYmd, -SHORT_TERM_LOOKBACK_DAYS);
  return meds
    .flatMap((med): CheckupMedication[] => {
      if (med.regimen === "long_term") {
        return med.relatedItems.includes(itemCode) && covers(med, checkupYmd)
          ? [{ id: med.id, name: med.name, kind: med.kind, regimen: med.regimen, endedDaysBefore: null }]
          : [];
      }
      // 단기: [검진일 − 14, 검진일] 과 겹침 (검진 뒤 시작은 제외)
      if (med.startDate > checkupYmd || med.endDate === null || med.endDate < windowStart) return [];
      const endedDaysBefore = med.endDate >= checkupYmd ? 0 : diffDaysYmd(med.endDate, checkupYmd);
      return [{ id: med.id, name: med.name, kind: med.kind, regimen: med.regimen, endedDaysBefore }];
    })
    .sort((a, b) => {
      if (a.regimen !== b.regimen) return a.regimen === "long_term" ? -1 : 1;
      const near = (a.endedDaysBefore ?? 0) - (b.endedDaysBefore ?? 0);
      return near !== 0 ? near : a.name.localeCompare(b.name, "ko");
    });
}

export interface ItemMedicationsDto {
  /** 이 항목을 관련 항목으로 지정한 약 (다이얼로그 "관련 복약") */
  related: MedicationDto[];
  /** 회차 id → 그 검진일에 함께 볼 약 (이력 표 배지) */
  byCheckup: Record<string, CheckupMedication[]>;
}

export function itemMedications(
  meds: readonly MedicationDto[],
  itemCode: string,
  points: readonly { checkupId: string; date: string }[],
): ItemMedicationsDto {
  return {
    related: medsForItem(meds, itemCode),
    byCheckup: Object.fromEntries(points.map((p) => [p.checkupId, medsForCheckup(meds, itemCode, p.date)])),
  };
}

/** 항목 추이 "관련 복약" — 이 항목을 관련 항목으로 지정한 약, 시작일 순 */
export function medsForItem(meds: readonly MedicationDto[], itemCode: string): MedicationDto[] {
  return meds.filter((m) => m.relatedItems.includes(itemCode)).sort((a, b) => a.startDate.localeCompare(b.startDate));
}
