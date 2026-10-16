// #527 (M18-1): 건강 기록 — 검진 회차 · 회차 상세 · 추적검사. 회차 선택은 `?round=<id>` (없으면 최신).
// #544 (M18-3): 검진 · 복약 탭 (`?tab=meds`).
import Link from "next/link";
import { todayKSTString } from "@/lib/garmin/utils";
import { getCheckupDetail, listCheckups, listCustomItems, listFollowUps } from "@/lib/checkup/queries";
import { listMedications } from "@/lib/medication/queries";
import RoundTimeline from "@/components/medical/RoundTimeline";
import FollowUpCard from "@/components/medical/FollowUpCard";
import CheckupDetail from "@/components/medical/CheckupDetail";
import MedicalTabs from "@/components/medical/MedicalTabs";
import MedsTab from "@/components/medical/meds/MedsTab";

export const dynamic = "force-dynamic";

interface MedicalPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const PRIMARY = "rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-[#04130a] hover:bg-accent-hover";

export default async function MedicalPage(props: MedicalPageProps) {
  const sp = (await props.searchParams) ?? {};
  if (sp.tab === "meds") return <MedsPage />;
  const requested = typeof sp.round === "string" ? sp.round : null;
  const [rounds, followUps] = await Promise.all([listCheckups(), listFollowUps()]);
  const currentId = rounds.find((r) => r.id === requested)?.id ?? rounds[0]?.id ?? null;
  const detail = currentId ? await getCheckupDetail(currentId) : null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">건강 기록</h1>
          <p className="text-dim text-sm">검진 결과와 복약 기간을 함께 봅니다</p>
        </div>
        {rounds.length > 0 && (
          <div className="flex gap-2">
            <Link href="/medical/import" className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm hover:border-border-hover">
              결과지 가져오기
            </Link>
            <Link href="/medical/new" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-[#04130a] hover:bg-accent-hover">
              검진 기록 추가
            </Link>
          </div>
        )}
      </div>
      <MedicalTabs current="checkups" />

      {rounds.length === 0 || !detail ? (
        <div className="bg-card border border-border rounded-xl px-6 py-10 text-center">
          <h2 className="text-base font-medium text-bright">아직 검진 기록이 없습니다</h2>
          <p className="mx-auto mt-1.5 mb-4 max-w-[44ch] text-sub text-sm">
            결과지 캡처 · PDF · 사진을 가져오거나 직접 입력하면, 회차가 쌓일수록 항목별 변화를 볼 수 있습니다.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/medical/import" className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-[#04130a] hover:bg-accent-hover">
              결과지 가져오기
            </Link>
            <Link href="/medical/new" className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm hover:border-border-hover">
              직접 입력
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="min-w-0">
            <RoundTimeline rounds={rounds} currentId={detail.id} />
            <FollowUpCard items={followUps} today={todayKSTString()} />
          </aside>
          <div className="min-w-0">
            <CheckupDetail key={detail.id} checkup={detail} />
          </div>
        </div>
      )}
    </div>
  );
}

async function MedsPage() {
  const [meds, rounds, custom] = await Promise.all([listMedications(), listCheckups(), listCustomItems()]);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">건강 기록</h1>
          <p className="text-dim text-sm">검진 결과와 복약 기간을 함께 봅니다</p>
        </div>
        <Link href="/medical/meds/new" className={PRIMARY}>
          복약 추가
        </Link>
      </div>
      <MedicalTabs current="meds" />
      {meds.length === 0 ? (
        <div className="bg-card border border-border rounded-xl px-6 py-10 text-center">
          <h2 className="text-base font-medium text-bright">아직 복약 기록이 없습니다</h2>
          <p className="mx-auto mt-1.5 mb-4 max-w-[46ch] text-sub text-sm">
            먹고 있는 약 · 영양제를 기간과 함께 남기면 검진 항목 추이에서 그 기간을 함께 볼 수 있습니다.
          </p>
          <Link href="/medical/meds/new" className={`inline-block ${PRIMARY}`}>
            복약 추가
          </Link>
        </div>
      ) : (
        <MedsTab
          meds={meds}
          checkupDates={rounds.map((r) => r.date)}
          customItems={Object.fromEntries(custom.map((c) => [c.code, c.label]))}
          today={todayKSTString()}
        />
      )}
    </div>
  );
}
