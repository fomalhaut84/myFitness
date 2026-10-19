// #552 R2: 코드 기본값 동기화 판단 — 순수. 릴리즈로 코드 프롬프트가 바뀌면 새 `code_default` 버전을 자동 추가한다 (2026-10-19 사용자 결정).
// 웹에서 고친 적 없으면 (사용 중 = 코드 기본값) 바로 사용, 고쳤으면 사용자 수정을 덮지 않게 초안으로.

export type PromptStatus = "draft" | "active" | "archived";
export type PromptSource = "code_default" | "manual" | "ai_suggestion" | "restore";

export interface SyncRow {
  id: string;
  version: number;
  status: PromptStatus;
  source: PromptSource;
  codeHash: string | null;
}

export type SyncAction =
  | { kind: "none" }
  | { kind: "insert"; version: number; status: "active" | "draft"; archiveId: string | null };

export function planDefaultsSync(rows: readonly SyncRow[], hash: string): SyncAction {
  if (rows.length === 0) return { kind: "insert", version: 1, status: "active", archiveId: null };

  const codeRows = rows.filter((r) => r.source === "code_default");
  const latestCode = codeRows.reduce<SyncRow | null>((acc, r) => (acc === null || r.version > acc.version ? r : acc), null);
  if (latestCode?.codeHash === hash) return { kind: "none" };

  const version = Math.max(...rows.map((r) => r.version)) + 1;
  const active = rows.find((r) => r.status === "active");
  if (!active) return { kind: "insert", version, status: "active", archiveId: null };
  if (active.source === "code_default") return { kind: "insert", version, status: "active", archiveId: active.id };
  return { kind: "insert", version, status: "draft", archiveId: null };
}
