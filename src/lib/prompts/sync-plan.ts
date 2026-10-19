// #552 R2: 코드 기본값 동기화 판단 — 순수. 릴리즈로 코드 프롬프트가 바뀌면 새 `code_default` 버전을 자동 추가한다 (2026-10-19 사용자 결정).
// 웹에서 고친 적 없으면 (사용 중 = 코드 기본값 · 또는 코드 기본값을 되돌린 버전) 바로 사용, 고쳤으면 사용자 수정을 덮지 않게 초안으로.

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

/**
 * 사용 중 버전이 코드 기본값 그대로인가 — 최신 코드 기본값을 되돌린 restore 도 포함 (codeHash 를 물려받는다 · 사전 리뷰 info 5).
 * 더 옛 기본값으로 되돌린 건 사용자가 고른 문구라 아니다 — 다음 기본값 갱신이 덮지 않는다.
 */
export function isStockDefault(row: Pick<SyncRow, "source" | "codeHash">, latestCodeHash: string | null): boolean {
  return row.source === "code_default" || (row.source === "restore" && row.codeHash !== null && row.codeHash === latestCodeHash);
}

export function latestCodeDefault<T extends Pick<SyncRow, "source" | "version">>(rows: readonly T[]): T | null {
  return rows.filter((r) => r.source === "code_default").reduce<T | null>((acc, r) => (acc === null || r.version > acc.version ? r : acc), null);
}

export function planDefaultsSync(rows: readonly SyncRow[], hash: string): SyncAction {
  if (rows.length === 0) return { kind: "insert", version: 1, status: "active", archiveId: null };

  const latestCode = latestCodeDefault(rows);
  if (latestCode?.codeHash === hash) return { kind: "none" };

  const version = Math.max(...rows.map((r) => r.version)) + 1;
  const active = rows.find((r) => r.status === "active");
  if (!active) return { kind: "insert", version, status: "active", archiveId: null };
  if (isStockDefault(active, latestCode?.codeHash ?? null)) return { kind: "insert", version, status: "active", archiveId: active.id };
  return { kind: "insert", version, status: "draft", archiveId: null };
}
