import type { Bot, InlineKeyboard } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToAll, sendToAllWithKeyboard } from "../send";

// 1a-2 회귀 baseline (pleiades 003 §5-2 · pleiades#58). 이 모듈은 1a-3 에서 @pleiades/notify 로 교체된다 —
// 절단(4096-3+"...") · 재시도 [2000, 8000, 30000] · HTML→plain 폴백 · SendResult 집계가 전환 전 동작이다.

const MAX_MSG = 4096;

function fakeBot(sendMessage: (...args: unknown[]) => Promise<unknown>) {
  const spy = vi.fn(sendMessage);
  return { bot: { api: { sendMessage: spy } } as unknown as Bot, sendMessage: spy };
}

function networkError(code: string): Error {
  return Object.assign(new Error(`request failed: ${code}`), { code });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sendToAll", () => {
  it("TELEGRAM_ALLOWED_CHAT_IDS 를 trim·빈 항목 제거해 전부에게 HTML 로 보낸다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", " 1, 2,,3 ");
    const { bot, sendMessage } = fakeBot(async () => ({ message_id: 1 }));
    const result = await sendToAll(bot, "<b>hi</b>");
    expect(result).toEqual({ sent: 3, failed: 0, total: 3 });
    expect(sendMessage.mock.calls.map((c) => c[0])).toEqual(["1", "2", "3"]);
    expect(sendMessage).toHaveBeenCalledWith("1", "<b>hi</b>", { parse_mode: "HTML" });
  });

  it("수신자가 없으면 아무것도 보내지 않는다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "");
    const { bot, sendMessage } = fakeBot(async () => ({}));
    expect(await sendToAll(bot, "x")).toEqual({ sent: 0, failed: 0, total: 0 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("4096 초과는 4093자 + '...' 로 절단한다 (1a-3 이 분할로 바꾸는 동작)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    const { bot, sendMessage } = fakeBot(async () => ({}));
    await sendToAll(bot, "a".repeat(5000));
    const sentText = sendMessage.mock.calls[0][1] as string;
    expect(sentText).toHaveLength(MAX_MSG);
    expect(sentText.endsWith("...")).toBe(true);
  });

  it("HTML 파싱 실패는 백오프 없이 plain 으로 즉시 재전송한다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    vi.useFakeTimers();
    let calls = 0;
    const { bot, sendMessage } = fakeBot(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Bad Request: can't parse entities");
      return {};
    });
    const result = await sendToAll(bot, "<b>bold</b> x");
    expect(result).toEqual({ sent: 1, failed: 0, total: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]).toEqual(["1", "bold x"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("네트워크 오류는 2000·8000·30000ms 뒤 재시도한다 (총 4회)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    vi.useFakeTimers();
    let calls = 0;
    const { bot, sendMessage } = fakeBot(async () => {
      calls += 1;
      if (calls < 4) throw networkError("ETIMEDOUT");
      return {};
    });
    const pending = sendToAll(bot, "x");
    await vi.advanceTimersByTimeAsync(1999);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30000);
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(await pending).toEqual({ sent: 1, failed: 0, total: 1 });
  });

  it("4회 모두 네트워크 오류면 실패로 집계하고 다음 수신자로 넘어간다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1,2");
    vi.useFakeTimers();
    const { bot, sendMessage } = fakeBot(async (chatId) => {
      if (chatId === "1") throw networkError("ECONNRESET");
      return {};
    });
    const pending = sendToAll(bot, "x");
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ sent: 1, failed: 1, total: 2 });
    expect(sendMessage).toHaveBeenCalledTimes(5);
  });

  it("네트워크 오류가 아니면 재시도 없이 실패로 집계한다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    const { bot, sendMessage } = fakeBot(async () => {
      throw new Error("Forbidden: bot was blocked by the user");
    });
    expect(await sendToAll(bot, "x")).toEqual({ sent: 0, failed: 1, total: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("실패 로그는 봇 토큰을 마스킹한다 (사전 리뷰 info 3 · 003 Q19 sensitiveLogs 경계)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    const { bot } = fakeBot(async () => {
      throw new Error("call to bot123456:ABC-def_78 failed");
    });
    await sendToAll(bot, "x");
    const logged = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(logged).toContain("bot<REDACTED>");
    expect(logged).not.toContain("ABC-def_78");
  });
});

describe("sendToAllWithKeyboard", () => {
  const keyboard = { inline_keyboard: [] } as unknown as InlineKeyboard;

  it("keyboard 를 붙여 보내고 첫 성공의 chatId·messageId 를 돌려준다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1,2");
    let id = 10;
    const { bot, sendMessage } = fakeBot(async () => ({ message_id: id++ }));
    const result = await sendToAllWithKeyboard(bot, "<b>q</b>", keyboard);
    expect(result).toEqual({
      sent: 2,
      failed: 0,
      total: 2,
      first: { chatId: "1", messageId: 10 },
    });
    expect(sendMessage).toHaveBeenCalledWith("1", "<b>q</b>", {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  it("재시도도 HTML 폴백도 없다 — 실패는 그대로 집계하고 first 는 첫 성공만", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1,2");
    const { bot, sendMessage } = fakeBot(async (chatId) => {
      if (chatId === "1") throw networkError("ETIMEDOUT");
      return { message_id: 7 };
    });
    const result = await sendToAllWithKeyboard(bot, "x", keyboard);
    expect(result).toEqual({
      sent: 1,
      failed: 1,
      total: 2,
      first: { chatId: "2", messageId: 7 },
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("모두 실패하면 first 는 undefined 다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    const { bot } = fakeBot(async () => {
      throw new Error("x");
    });
    const result = await sendToAllWithKeyboard(bot, "x", keyboard);
    expect(result.first).toBeUndefined();
    expect(result).toMatchObject({ sent: 0, failed: 1, total: 1 });
  });
});
