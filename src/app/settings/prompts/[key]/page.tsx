// #552 U2 · U3 · L4: 프롬프트 상세 — 편집 탭 (편집기 + 버전 계보 + 비교) · 결과 탭 (`?tab=results` · 버전별 결과 나란히)
import Link from "next/link";
import { notFound } from "next/navigation";
import PromptDetailClient from "@/components/prompts/PromptDetailClient";
import ResultsTab from "@/components/prompts/ResultsTab";
import { isPromptKey, PROMPT_DEFINITIONS } from "@/lib/prompts/definitions";
import { countResultsByVersion, listPromptResults } from "@/lib/prompts/results";
import { RESULTS_DEFAULT_LIMIT } from "@/lib/prompts/results-query";
import { listVersions } from "@/lib/prompts/versions";
import { listRuns } from "@/lib/prompts/runs";
import prisma from "@/lib/prisma";
import type { TrialActivity } from "@/components/prompts/TrialPanel";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** 시험 대상 후보 — 최근 활동 (평가 초안은 화면에서 같은 종류만 남긴다) */
const TRIAL_ACTIVITY_LIMIT = 20;

async function recentActivities(): Promise<TrialActivity[]> {
  const rows = await prisma.activity.findMany({
    orderBy: { startTime: "desc" },
    take: TRIAL_ACTIVITY_LIMIT,
    select: { id: true, name: true, activityType: true, startTime: true, distance: true },
  });
  return rows.map((r) => ({ ...r, startTime: r.startTime.toISOString() }));
}

const TAB_CLASS = "-mb-px border-b-2 px-3.5 py-2 text-sm";

export default async function PromptDetailPage({ params, searchParams }: Props) {
  const { key } = await params;
  if (!isPromptKey(key)) notFound();
  const tab = (await searchParams)?.tab === "results" ? "results" : "edit";
  const def = PROMPT_DEFINITIONS[key];
  const [versions, counts] = await Promise.all([listVersions(key), countResultsByVersion(key)]);
  const results = tab === "results" ? await listPromptResults(key, [], RESULTS_DEFAULT_LIMIT) : [];
  const [runs, activities] = tab === "edit" ? await Promise.all([listRuns(key), key === "system" || key.startsWith("activity_eval") ? recentActivities() : []]) : [[], []];
  const linkedTotal = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const active = versions.find((v) => v.status === "active") ?? null;

  return (
    <div>
      <Link href="/settings/prompts" className="mb-1.5 inline-block text-xs text-sub hover:text-bright">
        ← 프롬프트 목록
      </Link>
      <div className="mb-4">
        <h1 className="mb-1 text-2xl font-semibold">{def.label}</h1>
        <p className="text-sm text-dim">
          {def.usage} · {active ? <>지금 <span className="font-mono text-accent">v{active.version}</span> 사용 중</> : "사용 중 버전 없음 — 코드 기본값 사용"}
        </p>
      </div>
      <nav aria-label="프롬프트 상세" className="mb-5 flex gap-1 border-b border-border">
        <Link href={`/settings/prompts/${key}`} aria-current={tab === "edit" ? "page" : undefined} className={`${TAB_CLASS} ${tab === "edit" ? "border-accent text-bright" : "border-transparent text-sub hover:text-bright"}`}>
          편집
        </Link>
        <Link href={`/settings/prompts/${key}?tab=results`} aria-current={tab === "results" ? "page" : undefined} className={`${TAB_CLASS} ${tab === "results" ? "border-accent text-bright" : "border-transparent text-sub hover:text-bright"}`}>
          결과
          {linkedTotal > 0 && <small className="ml-1 font-mono text-[11px] text-dim">{linkedTotal}</small>}
        </Link>
      </nav>
      {tab === "results" ? (
        <ResultsTab promptKey={key} versions={versions} initialResults={results} />
      ) : (
        <PromptDetailClient promptKey={key} versions={versions} resultCounts={counts} runs={runs} activities={activities} />
      )}
    </div>
  );
}
