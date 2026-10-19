"use client";
// #552 M19-2 L4: 결과 본문 — `/reports` 와 같은 렌더 경로 (marked → DOMPurify)
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { useMemo } from "react";

export default function ResultDoc({ header, markdown }: { header: React.ReactNode; markdown: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string), [markdown]);
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 border-b border-border pb-2 font-mono text-xs text-sub">{header}</div>
      <div className="prose prose-invert prose-sm max-w-none [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
