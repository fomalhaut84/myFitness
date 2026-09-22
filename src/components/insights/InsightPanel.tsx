// #397 (M15-5): 패널 = 질문 → 차트 → 답. 제목이 곧 질문이고, 답은 `AnswerBlock` 의 숫자 하나 + 근거 표.
import type { ReactNode } from "react";

interface InsightPanelProps {
  question: string;
  how: string;
  /** 계산 규칙을 사용자 말로 (맨 아래 한 줄) */
  foot?: string;
  children: ReactNode;
}

export default function InsightPanel({ question, how, foot, children }: InsightPanelProps) {
  return (
    <section className="mb-3.5 rounded-xl border border-border bg-card px-2.5 pb-3 pt-3.5 sm:px-[18px] sm:pt-[18px]">
      <h2 className="text-[15px] font-semibold tracking-tight text-bright sm:text-[17px]">{question}</h2>
      <p className="mb-3 mt-0.5 text-[12px] text-sub">{how}</p>
      {children}
      {foot && <p className="mt-2 text-[11px] text-dim">{foot}</p>}
    </section>
  );
}

/** 답이 되는 숫자 하나 + 근거 (표) — 데스크톱 2열, 폰 1열 */
export function Answer({ children }: { children: ReactNode }) {
  return <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-[200px_1fr]">{children}</div>;
}

export function BigNumber({ label, text, unit, caption }: { label: string; text: string | null; unit?: string; caption?: string }) {
  return (
    <dl className="rounded-xl border border-border bg-bg px-3.5 py-3">
      <dt className="text-[11px] text-sub">{label}</dt>
      {text === null ? (
        <dd className="mt-1 text-[13px] text-dim">아직 답할 수 없음</dd>
      ) : (
        <dd className="mt-1 font-[family-name:var(--font-geist-mono)] text-[26px] font-medium leading-tight tracking-tight text-bright">
          {text}
          {unit && <span className="ml-1 text-[12px] font-normal text-sub">{unit}</span>}
        </dd>
      )}
      {caption && <dd className="mt-1 text-[11px] text-sub">{caption}</dd>}
    </dl>
  );
}
