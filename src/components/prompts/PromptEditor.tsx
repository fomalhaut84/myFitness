"use client";
// #552 U2: 프롬프트 편집기 — textarea 위에 같은 글꼴 · 줄 높이의 강조 레이어를 겹친다 (에디터 패키지 없음 · 디자인 노트 구현 메모).
// 줄바꿈 없이 (wrap off) 가로 스크롤 — 줄 번호와 검증 행 번호가 실제 줄과 맞도록.
import { useEffect, useRef, useState } from "react";
import type { PromptKey } from "@/lib/prompts/definitions";
import { isKnownTool, isKnownVariable } from "@/lib/prompts/validate";

const LINE_HEIGHT = 21;
const PAD_Y = 12;
const TOKEN_PATTERN = /(\{\{[^{}]*\}\})|(mcp__myfitness__[a-z_]+)/g;
const WAVY = "underline decoration-wavy decoration-red-400 underline-offset-[3px]";

function highlightLine(promptKey: PromptKey, line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN_PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) nodes.push(line.slice(last, at));
    if (m[1]) {
      const known = isKnownVariable(promptKey, m[1].slice(2, -2));
      nodes.push(
        <span key={at} className={`rounded-sm bg-amber-300/10 text-amber-300 ${known ? "" : WAVY}`}>
          {m[1]}
        </span>,
      );
    } else {
      nodes.push(
        <span key={at} className={`text-blue-300 ${isKnownTool(m[2]) ? "" : WAVY}`}>
          {m[2]}
        </span>,
      );
    }
    last = at + m[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

interface Props {
  promptKey: PromptKey;
  value: string;
  onChange: (value: string) => void;
  /** 검증 목록의 행 번호 클릭 → 그 줄로 (seq 가 바뀔 때마다 이동) */
  jumpTo?: { line: number; seq: number } | null;
}

export default function PromptEditor({ promptKey, value, onChange, jumpTo }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const handledSeq = useRef<number | null>(jumpTo?.seq ?? null);
  const lines = value.split("\n");

  // 한 요청은 한 번만 — 비교를 닫고 다시 마운트될 때 옛 요청으로 포커스를 뺏지 않게 (사전 리뷰 info 3)
  useEffect(() => {
    const el = textareaRef.current;
    if (!jumpTo || !el || handledSeq.current === jumpTo.seq) return;
    handledSeq.current = jumpTo.seq;
    const offset = el.value
      .split("\n")
      .slice(0, Math.max(0, jumpTo.line - 1))
      .reduce((sum, l) => sum + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(offset, offset);
    el.scrollTop = Math.max(0, (jumpTo.line - 3) * LINE_HEIGHT);
  }, [jumpTo]);

  const shared = { lineHeight: `${LINE_HEIGHT}px`, paddingTop: PAD_Y, paddingBottom: PAD_Y, tabSize: 2 } as const;

  return (
    <div className="relative h-[360px] overflow-hidden font-mono text-[12.5px] md:h-[460px]">
      <div aria-hidden className="absolute inset-y-0 left-0 w-10 select-none overflow-hidden text-right text-[#3a3a3a]" style={shared}>
        <div style={{ transform: `translateY(${-scroll.top}px)` }} className="pr-2.5">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      </div>
      <pre aria-hidden className="pointer-events-none absolute inset-y-0 left-10 right-0 m-0 overflow-hidden pl-1.5 pr-4 text-muted" style={shared}>
        <code className="block whitespace-pre" style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
          {lines.map((line, i) => (
            <div key={i} className={line.startsWith("#") ? "text-bright" : undefined}>
              {line.length > 0 ? highlightLine(promptKey, line) : " "}
            </div>
          ))}
        </code>
      </pre>
      <textarea
        ref={textareaRef}
        aria-label="프롬프트 본문"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
        wrap="off"
        spellCheck={false}
        className="absolute inset-y-0 left-10 right-0 h-full w-[calc(100%-2.5rem)] resize-none [color-scheme:dark] whitespace-pre bg-transparent pl-1.5 pr-4 text-transparent caret-bright outline-none selection:bg-blue-400/30"
        style={shared}
      />
    </div>
  );
}
