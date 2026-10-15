// 회귀: PR #518 Codex P2 — OMRON_EMAIL 을 바꿔도 이전 계정 refresh token 을 그대로 써서 다른 계정 데이터를 가져올 수 있었다
import { describe, expect, it } from "vitest";
import { storedTokenFor, tokenAccountKey } from "../client";

const base = { email: "a@example.com", appId: "app", apiBase: "https://api.example" };

describe("tokenAccountKey · storedTokenFor", () => {
  it("같은 계정 · 앱 · 서버면 저장 토큰을 쓴다 (이메일 대소문자 · 공백 무시)", () => {
    const key = tokenAccountKey(base);
    expect(tokenAccountKey({ ...base, email: " A@Example.com " })).toBe(key);
    expect(storedTokenFor(JSON.stringify({ refreshToken: "rt", account: key }), key)).toBe("rt");
  });

  it.each([
    ["이메일", { ...base, email: "b@example.com" }],
    ["앱", { ...base, appId: "other" }],
    ["서버", { ...base, apiBase: "https://other" }],
  ])("%s 이 다르면 무시", (_label, other) => {
    const saved = JSON.stringify({ refreshToken: "rt", account: tokenAccountKey(base) });
    expect(storedTokenFor(saved, tokenAccountKey(other))).toBeNull();
  });

  it("계정 표시가 없는 옛 파일 · 손상 파일은 무시", () => {
    const key = tokenAccountKey(base);
    expect(storedTokenFor(JSON.stringify({ refreshToken: "rt" }), key)).toBeNull();
    expect(storedTokenFor("{broken", key)).toBeNull();
  });
});
