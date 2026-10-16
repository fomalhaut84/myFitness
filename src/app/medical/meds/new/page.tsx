// #544 (M18-3): 복약 추가. `?from=<id>` 는 다시 시작 (같은 내용 · 시작일 오늘).
import { todayKSTString } from "@/lib/garmin/utils";
import { listCustomItems } from "@/lib/checkup/queries";
import { getMedication } from "@/lib/medication/queries";
import { emptyMedForm, restartFrom } from "@/lib/medication/form-model";
import { itemOptionGroups } from "@/lib/medication/item-options";
import MedicationForm from "@/components/medical/meds/MedicationForm";

export const dynamic = "force-dynamic";

interface NewMedicationPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewMedicationPage(props: NewMedicationPageProps) {
  const sp = (await props.searchParams) ?? {};
  const today = todayKSTString();
  const [from, custom] = await Promise.all([typeof sp.from === "string" ? getMedication(sp.from) : null, listCustomItems()]);
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">건강 기록</h1>
        <p className="text-dim text-sm">{from ? `${from.name} 다시 시작 — 내용을 확인하고 저장하세요` : "먹고 있거나 먹었던 약 · 영양제를 기간과 함께 남깁니다"}</p>
      </div>
      <MedicationForm initial={from ? restartFrom(from, today) : emptyMedForm(today)} maxDate={today} itemGroups={itemOptionGroups(custom)} />
    </div>
  );
}
