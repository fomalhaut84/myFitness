"use client";

// #394 (M15-2): 일 뷰 AI 리포트 본문. `/reports` 와 같은 렌더 경로 (marked → DOMPurify). 접힌 상태가 기본.
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { useMemo } from "react";

interface ReportBodyProps {
  title: string;
  markdown: string;
}

export default function ReportBody({ title, markdown }: ReportBodyProps) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string), [markdown]);
  return (
    <details className="group border-t border-border pt-3 first:border-t-0 first:pt-0">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 text-[13px] font-medium text-bright [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-[12px] font-normal text-sub group-open:hidden">펼치기</span>
        <span className="hidden text-[12px] font-normal text-sub group-open:inline">접기</span>
      </summary>
      <div className="prose prose-invert prose-sm mt-2 max-w-[62ch]" dangerouslySetInnerHTML={{ __html: html }} />
    </details>
  );
}
