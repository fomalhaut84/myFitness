// #527 (M18-1): 검진 기록 수정 — 결과 전체 교체 (PUT).
import { notFound } from "next/navigation";
import { todayKSTString } from "@/lib/garmin/utils";
import { getCheckupDetail } from "@/lib/checkup/queries";
import { formStateFromDetail } from "@/lib/checkup/form-model";
import CheckupForm from "@/components/medical/CheckupForm";

export const dynamic = "force-dynamic";

interface EditCheckupPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditCheckupPage({ params }: EditCheckupPageProps) {
  const { id } = await params;
  const detail = await getCheckupDetail(id);
  if (!detail) notFound();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">건강 기록</h1>
        <p className="text-dim text-sm">{detail.date} 검진 수정 · 저장하면 이 회차의 결과를 입력한 내용으로 바꿉니다</p>
      </div>
      <CheckupForm initial={formStateFromDetail(detail)} checkupId={detail.id} maxDate={todayKSTString()} />
    </div>
  );
}
