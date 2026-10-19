// #552 U6: 줄 단위 diff — 순수 LCS. 프롬프트는 수백 줄 이내라 O(n·m) 로 충분하다 (패키지 추가 없음).

export type DiffLine =
  | { type: "same"; text: string; oldLine: number; newLine: number }
  | { type: "del"; text: string; oldLine: number }
  | { type: "add"; text: string; newLine: number };

/** 표 크기 상한 — 넘으면 LCS 대신 전체 삭제 + 전체 추가 (브라우저가 멈추지 않게) */
const MAX_CELLS = 4_000_000;

function lcsTable(a: readonly string[], b: readonly string[]): Uint32Array[] {
  // table[i][j] = a[i..] 와 b[j..] 의 LCS 길이
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function replaceAll(a: readonly string[], b: readonly string[]): DiffLine[] {
  return [
    ...a.map((text, i): DiffLine => ({ type: "del", text, oldLine: i + 1 })),
    ...b.map((text, j): DiffLine => ({ type: "add", text, newLine: j + 1 })),
  ];
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return replaceAll(a, b);

  const table = lcsTable(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: "del", text: a[i], oldLine: i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j], newLine: j + 1 });
      j++;
    }
  }
  return [
    ...out,
    ...a.slice(i).map((text, k): DiffLine => ({ type: "del", text, oldLine: i + k + 1 })),
    ...b.slice(j).map((text, k): DiffLine => ({ type: "add", text, newLine: j + k + 1 })),
  ];
}

export type DiffBlock = { kind: "line"; line: DiffLine } | { kind: "fold"; count: number };

/** 바뀐 줄 앞뒤 `context` 줄만 남기고 같은 줄은 "같은 줄 N개" 로 접는다 */
export function foldDiff(lines: readonly DiffLine[], context = 2): DiffBlock[] {
  const keep = lines.map((line, idx) => {
    if (line.type !== "same") return true;
    const from = Math.max(0, idx - context);
    const to = Math.min(lines.length - 1, idx + context);
    return lines.slice(from, to + 1).some((l) => l.type !== "same");
  });
  const blocks: DiffBlock[] = [];
  let folded = 0;
  lines.forEach((line, idx) => {
    if (keep[idx]) {
      if (folded > 0) blocks.push({ kind: "fold", count: folded });
      folded = 0;
      blocks.push({ kind: "line", line });
    } else {
      folded++;
    }
  });
  return folded > 0 ? [...blocks, { kind: "fold", count: folded }] : blocks;
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.type === "add").length,
    removed: lines.filter((l) => l.type === "del").length,
  };
}
