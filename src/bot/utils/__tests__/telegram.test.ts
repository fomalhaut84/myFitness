import type { Context } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { escapeHtml, mdToHtml, replyLong } from "../telegram";

// 1a-2 회귀 baseline (pleiades 003 §5-2 · pleiades#58). splitMessage 는 비export 라 replyLong 경유로 검증한다.

const MAX = 4096;

function fakeCtx(reply: (text: string, other?: unknown) => Promise<unknown>) {
  const spy = vi.fn(reply);
  return { ctx: { reply: spy } as unknown as Context, reply: spy };
}

describe("mdToHtml", () => {
  it("헤더 · 굵게 · 기울임 · 코드 · 불릿을 변환한다", () => {
    expect(mdToHtml("### 제목")).toBe("<b>제목</b>");
    expect(mdToHtml("## 제목")).toBe("<b>제목</b>");
    expect(mdToHtml("# 제목")).toBe("<b>제목</b>");
    expect(mdToHtml("**굵게**")).toBe("<b>굵게</b>");
    expect(mdToHtml("*기울임*")).toBe("<i>기울임</i>");
    expect(mdToHtml("`코드`")).toBe("<code>코드</code>");
    expect(mdToHtml("목록\n- 항목")).toBe("목록\n• 항목");
  });

  it("마크다운이 없으면 원문을 유지한다", () => {
    expect(mdToHtml("plain")).toBe("plain");
  });
});

describe("escapeHtml", () => {
  it("& < > 를 이스케이프한다", () => {
    expect(escapeHtml("a & <b> > c")).toBe("a &amp; &lt;b&gt; &gt; c");
  });

  it("따옴표는 건드리지 않는다", () => {
    expect(escapeHtml(`"q" 'q'`)).toBe(`"q" 'q'`);
  });
});

describe("replyLong", () => {
  it("짧은 텍스트는 한 번만 보내고 parse_mode 를 붙이지 않는다", async () => {
    const { ctx, reply } = fakeCtx(async () => ({}));
    await replyLong(ctx, "hello");
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("hello", { parse_mode: undefined });
  });

  it("html=true 면 parse_mode HTML 로 보낸다", async () => {
    const { ctx, reply } = fakeCtx(async () => ({}));
    await replyLong(ctx, "<b>x</b>", true);
    expect(reply).toHaveBeenCalledWith("<b>x</b>", { parse_mode: "HTML" });
  });

  it("4096 초과 시 줄 경계에서 나누고 다음 청크의 선행 공백을 지운다", async () => {
    const { ctx, reply } = fakeCtx(async () => ({}));
    const text = `${"a".repeat(3000)}\n${"b".repeat(2000)}`;
    await replyLong(ctx, text);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[0][0]).toBe("a".repeat(3000));
    expect(reply.mock.calls[1][0]).toBe("b".repeat(2000));
  });

  it("줄 경계가 절반 앞이면 4096 에서 하드 슬라이스한다", async () => {
    const { ctx, reply } = fakeCtx(async () => ({}));
    const text = `${"a".repeat(1000)}\n${"b".repeat(5000)}`;
    await replyLong(ctx, text);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[0][0]).toHaveLength(MAX);
    expect(reply.mock.calls[1][0]).toBe("b".repeat(6001 - MAX));
  });

  it("줄 경계가 정확히 절반(2048)이면 줄에서 나누고, 2047 이면 하드 슬라이스한다", async () => {
    // 사전 리뷰 info 2: splitAt < maxLength / 2 의 경계값
    const half = MAX / 2;
    const atHalf = fakeCtx(async () => ({}));
    await replyLong(atHalf.ctx, `${"a".repeat(half)}\n${"b".repeat(3000)}`);
    expect(atHalf.reply.mock.calls[0][0]).toBe("a".repeat(half));
    const belowHalf = fakeCtx(async () => ({}));
    await replyLong(belowHalf.ctx, `${"a".repeat(half - 1)}\n${"b".repeat(3000)}`);
    expect(belowHalf.reply.mock.calls[0][0]).toHaveLength(MAX);
  });

  it("정확히 4096 이면 나누지 않는다", async () => {
    const { ctx, reply } = fakeCtx(async () => ({}));
    await replyLong(ctx, "a".repeat(MAX));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("HTML 파싱 실패 시 태그를 벗기고 plain 으로 재전송한다", async () => {
    let calls = 0;
    const { ctx, reply } = fakeCtx(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Bad Request: can't parse entities");
      return {};
    });
    await replyLong(ctx, "<b>bold</b> <i>x</i>", true);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[1]).toEqual(["bold x"]);
  });
});
