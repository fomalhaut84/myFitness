// #552 U2: 편집기 아래 검증 결과 — 오류 (저장 불가) · 경고 (저장 가능) · 통과 요약. 행 번호를 누르면 그 줄로
import type { PromptKey } from "@/lib/prompts/definitions";
import { requirementCounts, type PromptValidation } from "@/lib/prompts/validate";

interface Props {
  promptKey: PromptKey;
  validation: PromptValidation;
  /** 사용 중 버전 대비 빠진 도구 언급 (#203) — 활성화 전에 확인 필요 */
  removedToolsText: string | null;
  /** 본문이 언급하는 어드바이저 도구 수 */
  toolCount: number;
  onJump: (line: number) => void;
}

function LineLink({ line, onJump }: { line?: number; onJump: (line: number) => void }) {
  if (line === undefined) return null;
  return (
    <button type="button" onClick={() => onJump(line)} className="ml-1 font-mono text-[11px] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100">
      {line}행
    </button>
  );
}

export default function ValidationPanel({ promptKey, validation, removedToolsText, toolCount, onJump }: Props) {
  const { snippets, variables } = requirementCounts(promptKey);
  const requirements = [snippets > 0 ? `필수 문구 ${snippets}개` : null, variables > 0 ? `필수 변수 ${variables}개` : null].filter(Boolean).join(" · ");
  const summary = [requirements ? `${requirements} 모두 있음` : "검증 통과", toolCount > 0 ? `도구 언급 ${toolCount}개${removedToolsText ? "" : " (사용 중 버전과 같거나 많음)"}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <ul className="grid gap-1 border-t border-border px-3.5 py-2.5 text-xs" aria-live="polite">
      {validation.errors.map((e, i) => (
        <li key={`e${i}`} className="flex gap-2 text-red-400">
          <span aria-hidden>✕</span>
          <span>
            {e.message}
            <LineLink line={e.line} onJump={onJump} />
          </span>
        </li>
      ))}
      {removedToolsText && (
        <li className="flex gap-2 text-amber-300">
          <span aria-hidden>!</span>
          <span>{removedToolsText}. 활성화하려면 아래에서 확인하세요</span>
        </li>
      )}
      {validation.warnings.map((w, i) => (
        <li key={`w${i}`} className="flex gap-2 text-amber-300">
          <span aria-hidden>!</span>
          <span>
            {w.message}
            <LineLink line={w.line} onJump={onJump} />
          </span>
        </li>
      ))}
      {validation.errors.length === 0 && (
        <li className="flex gap-2 text-accent">
          <span aria-hidden>✓</span>
          <span>{summary}</span>
        </li>
      )}
    </ul>
  );
}
