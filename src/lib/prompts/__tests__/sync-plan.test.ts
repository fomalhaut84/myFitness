// #552 R2: 코드 기본값이 바뀌면 새 버전 자동 추가 — 웹에서 고친 적 없으면 바로 사용, 고쳤으면 초안 (사용자 결정 2026-10-19)
import { describe, expect, it } from "vitest";
import { planDefaultsSync, type SyncRow } from "../sync-plan";
import { summarize } from "../versions";

const row = (over: Partial<SyncRow> & Pick<SyncRow, "version">): SyncRow => ({
  id: `v${over.version}`,
  status: "archived",
  source: "code_default",
  codeHash: "h1",
  ...over,
});

describe("planDefaultsSync", () => {
  it("행이 없으면 v1 을 사용 중으로", () => {
    expect(planDefaultsSync([], "h1")).toEqual({ kind: "insert", version: 1, status: "active", archiveId: null });
  });

  it("최신 코드 기본값 해시가 같으면 아무것도 하지 않는다 (idempotent)", () => {
    const rows = [row({ version: 1, status: "active" })];
    expect(planDefaultsSync(rows, "h1")).toEqual({ kind: "none" });
  });

  it("사용 중이 코드 기본값이면 새 기본값을 바로 사용 — 이전 것은 보관", () => {
    const rows = [row({ version: 1, status: "active" })];
    expect(planDefaultsSync(rows, "h2")).toEqual({ kind: "insert", version: 2, status: "active", archiveId: "v1" });
  });

  it.each(["manual", "ai_suggestion", "restore"] as const)("사용 중이 웹에서 고친 버전 (%s) 이면 초안으로 — 사용자 수정을 덮지 않는다", (source) => {
    const rows = [row({ version: 1 }), row({ version: 2, status: "active", source, codeHash: null })];
    expect(planDefaultsSync(rows, "h2")).toEqual({ kind: "insert", version: 3, status: "draft", archiveId: null });
  });

  it("이미 넣은 초안 기본값과 해시가 같으면 다시 넣지 않는다", () => {
    const rows = [row({ version: 1 }), row({ version: 2, status: "active", source: "manual", codeHash: null }), row({ version: 3, status: "draft", codeHash: "h2" })];
    expect(planDefaultsSync(rows, "h2")).toEqual({ kind: "none" });
  });

  // 사전 리뷰 info 5: 최신 기본값으로 되돌린 건 "기본값 그대로" — 다음 갱신도 자동 적용
  it("최신 코드 기본값을 되돌린 버전 (codeHash 승계) 을 쓰는 중이면 새 기본값을 바로 사용", () => {
    const rows = [row({ version: 1 }), row({ version: 2, source: "manual", codeHash: null }), row({ version: 3, status: "active", source: "restore", codeHash: "h1" })];
    expect(planDefaultsSync(rows, "h2")).toEqual({ kind: "insert", version: 4, status: "active", archiveId: "v3" });
  });

  it("더 옛 코드 기본값으로 되돌린 건 사용자가 고른 문구 — 새 기본값은 초안", () => {
    const rows = [row({ version: 1, codeHash: "h0" }), row({ version: 2, codeHash: "h1" }), row({ version: 3, status: "active", source: "restore", codeHash: "h0" })];
    expect(planDefaultsSync(rows, "h2")).toEqual({ kind: "insert", version: 4, status: "draft", archiveId: null });
  });

  it("사용 중이 없으면 새 기본값을 사용 중으로", () => {
    const rows = [row({ version: 1 })];
    expect(planDefaultsSync(rows, "h2")).toEqual({ kind: "insert", version: 2, status: "active", archiveId: null });
  });

  it("번호는 기존 최대 + 1 (초안 포함)", () => {
    const rows = [row({ version: 1, status: "active" }), row({ version: 4, status: "draft", source: "manual", codeHash: null })];
    expect(planDefaultsSync(rows, "h2")).toMatchObject({ version: 5 });
  });
});

describe("summarize", () => {
  const at = new Date("2026-10-19T00:00:00Z");
  it("웹 수정 버전 사용 중 + 더 새 코드 기본값 초안 → pendingCodeDefault", () => {
    const s = summarize("weekly_report", [
      { version: 4, status: "active", source: "manual", activatedAt: at },
      { version: 5, status: "draft", source: "code_default", activatedAt: null },
    ]);
    expect(s).toEqual({ key: "weekly_report", active: { version: 4, source: "manual", activatedAt: at.toISOString() }, draftCount: 1, pendingCodeDefault: true });
  });

  it("사람이 만든 초안만 있으면 pendingCodeDefault 아님", () => {
    const s = summarize("system", [
      { version: 1, status: "active", source: "code_default", activatedAt: at },
      { version: 2, status: "draft", source: "manual", activatedAt: null },
    ]);
    expect(s.pendingCodeDefault).toBe(false);
    expect(s.draftCount).toBe(1);
  });

  it("행이 없으면 active null", () => {
    expect(summarize("system", []).active).toBeNull();
  });
});
