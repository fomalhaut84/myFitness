// #527 (M18-1): 검진 기록 추가.
import { todayKSTString } from "@/lib/garmin/utils";
import { emptyFormState } from "@/lib/checkup/form-model";
import CheckupForm from "@/components/medical/CheckupForm";

export const dynamic = "force-dynamic";

export default function NewCheckupPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">건강 기록</h1>
        <p className="text-dim text-sm">결과지에 적힌 대로 입력하세요. 기준범위도 결과지 표기 그대로 넣으면 됩니다</p>
      </div>
      <CheckupForm initial={emptyFormState(todayKSTString())} maxDate={todayKSTString()} />
    </div>
  );
}
