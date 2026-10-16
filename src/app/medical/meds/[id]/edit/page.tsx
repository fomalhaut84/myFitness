// #544 (M18-3): 복약 수정 · 삭제.
import { notFound } from "next/navigation";
import { todayKSTString } from "@/lib/garmin/utils";
import { listCustomItems } from "@/lib/checkup/queries";
import { getMedication } from "@/lib/medication/queries";
import { medFormFromDto } from "@/lib/medication/form-model";
import { itemOptionGroups } from "@/lib/medication/item-options";
import MedicationForm from "@/components/medical/meds/MedicationForm";

export const dynamic = "force-dynamic";

interface EditMedicationPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMedicationPage({ params }: EditMedicationPageProps) {
  const { id } = await params;
  const [med, custom] = await Promise.all([getMedication(id), listCustomItems()]);
  if (!med) notFound();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">건강 기록</h1>
        <p className="text-dim text-sm">{med.name} 수정</p>
      </div>
      <MedicationForm initial={medFormFromDto(med)} medId={med.id} maxDate={todayKSTString()} itemGroups={itemOptionGroups(custom)} />
    </div>
  );
}
