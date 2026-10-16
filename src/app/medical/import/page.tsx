// #532 (M18-2): 결과지 가져오기 — 캡처 · PDF · 종이 사진 → 확인 → 회차별 저장.
import Link from "next/link";
import { todayKSTString } from "@/lib/garmin/utils";
import CheckupImport from "@/components/medical/import/CheckupImport";

export const dynamic = "force-dynamic";

export default function CheckupImportPage() {
  return (
    <div>
      <div className="mb-6">
        <Link href="/medical" className="text-[13px] text-sub hover:text-bright">
          ← 건강 기록
        </Link>
        <h1 className="text-2xl font-semibold mb-1">결과지 가져오기</h1>
        <p className="text-dim text-sm">결과지 이미지에서 항목을 읽고, 확인한 뒤 회차별로 저장합니다</p>
      </div>
      <CheckupImport today={todayKSTString()} />
    </div>
  );
}
