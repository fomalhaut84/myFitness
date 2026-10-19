// #552 U2 · U3: 프롬프트 상세 — 편집기 + 버전 계보 + 버전 비교
import Link from "next/link";
import { notFound } from "next/navigation";
import PromptDetailClient from "@/components/prompts/PromptDetailClient";
import { isPromptKey, PROMPT_DEFINITIONS } from "@/lib/prompts/definitions";
import { listVersions } from "@/lib/prompts/versions";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ key: string }>;
}

export default async function PromptDetailPage({ params }: Props) {
  const { key } = await params;
  if (!isPromptKey(key)) notFound();
  const def = PROMPT_DEFINITIONS[key];
  const versions = await listVersions(key);
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
      <PromptDetailClient promptKey={key} versions={versions} />
    </div>
  );
}
