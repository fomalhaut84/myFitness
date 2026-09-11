import { describe, expect, it } from "vitest";
import {
  getErrorCode,
  isHtmlParseError,
  isNetworkError,
  sanitizeError,
  sanitizeMessage,
} from "../error";

// 1a-2 회귀 baseline (pleiades 003 §5-2 · pleiades#58). isHtmlParseError 는 @pleiades/notify 코어의
// 폴백 판정 정본이므로(003 §3-1) 1a-3 전환 전후로 같은 판정을 유지해야 한다.

describe("sanitizeMessage", () => {
  it("봇 토큰을 마스킹한다", () => {
    expect(sanitizeMessage("call bot123456:ABC-def_78 failed")).toBe(
      "call bot<REDACTED> failed",
    );
  });

  it("토큰이 없으면 원문을 유지한다", () => {
    expect(sanitizeMessage("plain message")).toBe("plain message");
  });
});

describe("sanitizeError", () => {
  it("Error 는 name: message 형태로 만든다", () => {
    expect(sanitizeError(new Error("boom"))).toBe("Error: boom");
  });

  it("cause 체인을 ' | ' 로 잇는다", () => {
    const inner = new TypeError("inner");
    const outer = new Error("outer", { cause: inner });
    expect(sanitizeError(outer)).toBe("Error: outer | TypeError: inner");
  });

  it("error 속성(grammy HttpError 형태)도 따라간다", () => {
    const outer = Object.assign(new Error("outer"), {
      error: new Error("bot123:abc timed out"),
    });
    expect(sanitizeError(outer)).toBe(
      "Error: outer | Error: bot<REDACTED> timed out",
    );
  });

  it("체인은 최대 5단계까지만 따라간다", () => {
    let err: Error = new Error("e6");
    for (let i = 5; i >= 0; i--) {
      err = new Error(`e${i}`, { cause: err });
    }
    expect(sanitizeError(err)).toBe(
      "Error: e0 | Error: e1 | Error: e2 | Error: e3 | Error: e4",
    );
  });

  it("문자열 · 객체 · 직렬화 불가 값을 처리한다", () => {
    expect(sanitizeError("bot1:x")).toBe("bot<REDACTED>");
    expect(sanitizeError({ code: 1 })).toBe('{"code":1}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sanitizeError(circular)).toBe("[unserializable]");
  });

  it("null · undefined 는 빈 문자열이다", () => {
    expect(sanitizeError(null)).toBe("");
    expect(sanitizeError(undefined)).toBe("");
  });
});

describe("getErrorCode", () => {
  it("최상위 code 를 돌려준다", () => {
    expect(getErrorCode({ code: "ETIMEDOUT" })).toBe("ETIMEDOUT");
  });

  it("error / cause 안의 code 를 찾는다", () => {
    expect(getErrorCode({ error: { code: "ECONNRESET" } })).toBe("ECONNRESET");
    expect(getErrorCode(new Error("x", { cause: { code: "EAI_AGAIN" } }))).toBe(
      "EAI_AGAIN",
    );
  });

  it("문자열이 아닌 code 나 비객체는 undefined 다", () => {
    expect(getErrorCode({ code: 500 })).toBeUndefined();
    expect(getErrorCode("ETIMEDOUT")).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
  });
});

describe("isNetworkError", () => {
  it.each([
    "ETIMEDOUT",
    "ECONNRESET",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "EHOSTUNREACH",
  ])("코드 %s 는 네트워크 오류다", (code) => {
    expect(isNetworkError({ code })).toBe(true);
  });

  it("ENOTFOUND 는 myFitness 목록에 없다 (fin 과의 차이 — 003 §3-1)", () => {
    expect(isNetworkError({ code: "ENOTFOUND" })).toBe(false);
  });

  it("grammy timeoutSeconds 메시지 · AbortError · type=aborted 를 잡는다", () => {
    expect(
      isNetworkError(
        new Error("Request to 'sendMessage' timed out after 30 seconds"),
      ),
    ).toBe(true);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isNetworkError(abort)).toBe(true);
    expect(
      isNetworkError(Object.assign(new Error("x"), { type: "aborted" })),
    ).toBe(true);
  });

  it("중첩된 cause 안의 timeout 도 잡는다", () => {
    const inner = new Error("Request to 'getMe' timed out after 10 seconds");
    expect(isNetworkError(new Error("outer", { cause: inner }))).toBe(true);
  });

  it("일반 오류는 네트워크 오류가 아니다", () => {
    expect(isNetworkError(new Error("Bad Request: chat not found"))).toBe(false);
    expect(isNetworkError("ETIMEDOUT")).toBe(false);
  });
});

describe("isHtmlParseError", () => {
  it("텔레그램 entity 파싱 오류 메시지를 판정한다", () => {
    expect(isHtmlParseError(new Error("Bad Request: can't parse entities: Unsupported start tag"))).toBe(true);
    expect(isHtmlParseError(new Error("Bad Request: can't find end of the entity starting at byte offset 3"))).toBe(true);
    expect(isHtmlParseError("can't parse entities")).toBe(true);
  });

  it("다른 400 오류는 파싱 오류가 아니다", () => {
    expect(isHtmlParseError(new Error("Bad Request: chat not found"))).toBe(false);
    expect(isHtmlParseError(new Error("Bad Request: message is too long"))).toBe(false);
    expect(isHtmlParseError(null)).toBe(false);
  });
});
