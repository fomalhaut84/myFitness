// #552 R6: 시스템 프롬프트 버전이 바뀌면 다음 호출에서 새 세션 — 웹 · 봇이 별도 프로세스라 활성화 시점에 세션을 비울 수 없다
import { afterEach, describe, expect, it } from "vitest";
import { getSession, resetAll, setSession } from "../session-store";

describe("session-store 시스템 프롬프트 버전", () => {
  afterEach(() => resetAll());

  it("같은 버전이면 세션을 이어 쓴다", () => {
    setSession("web", "s1", 10, "pv1");
    expect(getSession("web", "pv1")).toBe("s1");
  });

  it("다른 버전이 활성화되면 세션을 버린다 (다시 조회해도 없음)", () => {
    setSession("web", "s1", 10, "pv1");
    expect(getSession("web", "pv2")).toBeNull();
    expect(getSession("web")).toBeNull();
  });

  it("폴백 (null) ↔ DB 버전 전환도 새 세션", () => {
    setSession("telegram", "s1", 10, null);
    expect(getSession("telegram", "pv1")).toBeNull();
  });

  it("버전을 넘기지 않는 조회 (getSessionId) 는 버전을 보지 않는다", () => {
    setSession("web", "s1", 10, "pv1");
    expect(getSession("web")).toBe("s1");
  });
});
