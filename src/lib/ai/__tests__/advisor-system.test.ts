// #552 M19-3 T3: 시스템 프롬프트 초안 시험 — override 가 있으면 DB 사용 중 버전을 읽지 않는다
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolve = vi.hoisted(() => ({ resolvePromptTemplate: vi.fn() }));
vi.mock("@/lib/prompts/resolve", () => resolve);
vi.mock("@/lib/prisma", () => ({ default: {} }));

import { resolveAdvisorSystem } from "../claude-advisor";

beforeEach(() => {
  resolve.resolvePromptTemplate.mockReset();
  resolve.resolvePromptTemplate.mockResolvedValue({ body: "사용 중", versionId: "active1", fallback: false });
});

describe("resolveAdvisorSystem", () => {
  it("override 없음 → 사용 중 버전", async () => {
    await expect(resolveAdvisorSystem()).resolves.toEqual({ body: "사용 중", versionId: "active1" });
    expect(resolve.resolvePromptTemplate).toHaveBeenCalledWith("system");
  });

  it("override → 초안 본문 · 버전 (DB 조회 없음)", async () => {
    await expect(resolveAdvisorSystem({ systemOverride: { body: "초안", versionId: "draft1" } })).resolves.toEqual({ body: "초안", versionId: "draft1" });
    expect(resolve.resolvePromptTemplate).not.toHaveBeenCalled();
  });
});
