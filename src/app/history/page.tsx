// #394 (M15-2): `/history` → 올해 (KST) 연 뷰.
import { redirect } from "next/navigation";
import { todayKSTString } from "@/lib/garmin/utils";
import { historyYearPath } from "@/lib/history/route-params";

export const dynamic = "force-dynamic";

export default function HistoryIndexPage() {
  redirect(historyYearPath(Number(todayKSTString().slice(0, 4))));
}
