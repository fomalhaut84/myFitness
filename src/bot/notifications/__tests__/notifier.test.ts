import type { Bot, InlineKeyboard } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, html } from "@pleiades/notify";
import cron from "node-cron";
import prisma from "@/lib/prisma";
import { generateMorningReport } from "@/lib/daily-report";
import { recommendTodayWorkout } from "@/mcp/tools/recommend-today-workout";
import { BOT_NOTIFY_CTX, notifierFor } from "../notifier";
import { startBotScheduler } from "../scheduler";
import { runAutoAdjustProposal } from "../auto-adjust";
import { runAutoAdjustMaintenance } from "../auto-adjust-cron";
import { notifyClaudeAuthExpiredIfNeeded } from "@/lib/monitoring/admin-alerts";

// 1a-3 (pleiades#95 · 003 §5-2): send.ts(sendToAll / sendToAllWithKeyboard) → @pleiades/notify 교체.
// 1a-2 회귀 baseline 11건(pleiades#58)을 이 파일로 이식했다 — 불변 9 · 의도 변경 2(절단 → 분할 Q10-L ① ·
// 키보드 경로 재시도 003 §4-1(a)). 아래 "호출부" 블록은 교체된 호출 6건이 label 'bot' 을 넘기고
// first.ref 를 telegramMessageId 로 그대로 저장하는지를 고정한다.

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({
  default: {
    userProfile: { findFirst: vi.fn() },
    trainingWorkout: { findFirst: vi.fn() },
    workoutAdjustment: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    aIAdvice: { create: vi.fn() },
    systemAlertState: { updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/daily-report", () => ({
  generateMorningReport: vi.fn(),
  generateEveningReport: vi.fn(),
  preSyncForReport: vi.fn(),
}));
vi.mock("@/lib/weekly-report", () => ({ generateWeeklyReport: vi.fn() }));
vi.mock("@/mcp/tools/recommend-today-workout", () => ({ recommendTodayWorkout: vi.fn() }));
vi.mock("@/mcp/tools/injury-risk", () => ({
  getInjuryRiskScore: vi.fn(async () => ({ content: [{ text: '{"topFactors":[]}' }] })),
}));

function fakeBot(sendMessage: (...args: unknown[]) => Promise<unknown>) {
  const spy = vi.fn(sendMessage);
  return { bot: { api: { sendMessage: spy } } as unknown as Bot, sendMessage: spy };
}

function networkError(code: string): Error {
  return Object.assign(new Error(`request failed: ${code}`), { code });
}

/** 교체된 호출부와 같은 형태 — `notifierFor(bot).notify(Route.ALLOWED, html(text, keyboard?), BOT_NOTIFY_CTX)`. */
function send(bot: Bot, text: string, keyboard?: InlineKeyboard) {
  return notifierFor(bot).notify(Route.ALLOWED, html(text, keyboard), BOT_NOTIFY_CTX);
}

function errorLogs(): string[] {
  return vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("notifierFor — 일반 전송 (구 sendToAll baseline)", () => {
  it("TELEGRAM_ALLOWED_CHAT_IDS 를 trim·빈 항목 제거해 전부에게 HTML 로 보낸다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", " 1, 2,,3 ");
    const { bot, sendMessage } = fakeBot(async () => ({ message_id: 1 }));
    const result = await send(bot, "<b>hi</b>");
    expect(result).toMatchObject({ sent: 3, failed: 0, total: 3 });
    expect(sendMessage.mock.calls.map((c) => c[0])).toEqual(["1", "2", "3"]);
    expect(sendMessage).toHaveBeenCalledWith("1", "<b>hi</b>", { parse_mode: "HTML" });
  });

  it("수신자가 없으면 아무것도 보내지 않는다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "");
    const { bot, sendMessage } = fakeBot(async () => ({}));
    expect(await send(bot, "x")).toMatchObject({ sent: 0, failed: 0, total: 0 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("4096 초과는 절단하지 않고 분할한다 — 한 줄이면 하드 슬라이스 4096 + 904 (의도 변경 · Q10-L ① · pleiades 003 §5-2)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    let id = 1;
    const { bot, sendMessage } = fakeBot(async () => ({ message_id: id++ }));
    const text = "a".repeat(5000);
    const result = await send(bot, text);
    expect(result).toMatchObject({ sent: 1, failed: 0, total: 1 });
    const chunks = sendMessage.mock.calls.map((c) => c[1] as string);
    expect(chunks.map((c) => c.length)).toEqual([4096, 904]);
    expect(chunks.join("")).toBe(text);
    expect(chunks.some((c) => c.endsWith("..."))).toBe(false);
  });

  it("HTML 파싱 실패는 백오프 없이 plain 으로 즉시 재전송한다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    vi.useFakeTimers();
    let calls = 0;
    const { bot, sendMessage } = fakeBot(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Bad Request: can't parse entities");
      return { message_id: 1 };
    });
    const result = await send(bot, "<b>bold</b> x");
    expect(result).toMatchObject({ sent: 1, failed: 0, total: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    // 셋째 인자 {} 는 인자 생략과 같은 payload (grammy api.sendMessage 가 other 를 펼친다)
    expect(sendMessage.mock.calls[1]).toEqual(["1", "bold x", {}]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("네트워크 오류는 2000·8000·30000ms 뒤 재시도한다 (총 4회)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    vi.useFakeTimers();
    let calls = 0;
    const { bot, sendMessage } = fakeBot(async () => {
      calls += 1;
      if (calls < 4) throw networkError("ETIMEDOUT");
      return { message_id: 1 };
    });
    const pending = send(bot, "x");
    await vi.advanceTimersByTimeAsync(1999);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8000);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30000);
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(await pending).toMatchObject({ sent: 1, failed: 0, total: 1 });
  });

  it("4회 모두 네트워크 오류면 실패로 집계하고 다음 수신자로 넘어간다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1,2");
    vi.useFakeTimers();
    const { bot, sendMessage } = fakeBot(async (chatId) => {
      if (chatId === "1") throw networkError("ECONNRESET");
      return { message_id: 1 };
    });
    const pending = send(bot, "x");
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ sent: 1, failed: 1, total: 2 });
    expect(sendMessage).toHaveBeenCalledTimes(5);
  });

  it("네트워크 오류가 아니면 재시도 없이 실패로 집계한다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    const { bot, sendMessage } = fakeBot(async () => {
      throw new Error("Forbidden: bot was blocked by the user");
    });
    expect(await send(bot, "x")).toMatchObject({ sent: 0, failed: 1, total: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("실패 로그는 봇 토큰을 마스킹하고 [bot] prefix 를 유지한다 (003 Q19 sensitiveLogs 경계 · #48 I2)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    const { bot } = fakeBot(async () => {
      throw new Error("call to bot123456:ABC-def_78 failed");
    });
    await send(bot, "x");
    const logged = errorLogs()[0];
    expect(logged.startsWith("[bot] 메시지 전송 실패 (1): ")).toBe(true);
    expect(logged).toContain("bot<REDACTED>");
    expect(logged).not.toContain("ABC-def_78");
  });

  it("ENOTFOUND 도 네트워크 오류로 재시도한다 (신규 · 패키지 isNetworkError 7코드 · 1a-3 S-4)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    vi.useFakeTimers();
    let calls = 0;
    const { bot, sendMessage } = fakeBot(async () => {
      calls += 1;
      if (calls === 1) throw networkError("ENOTFOUND");
      return { message_id: 1 };
    });
    const pending = send(bot, "x");
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ sent: 1, failed: 0, total: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const warned = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(warned[0].startsWith("[bot] 전송 재시도 1/4 (1, 2000ms 후): ")).toBe(true);
  });
});

describe("notifierFor — 키보드 전송 (구 sendToAllWithKeyboard baseline)", () => {
  const keyboard = { inline_keyboard: [] } as unknown as InlineKeyboard;

  it("keyboard 를 붙여 보내고 첫 성공의 target·ref 를 돌려준다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1,2");
    let id = 10;
    const { bot, sendMessage } = fakeBot(async () => ({ message_id: id++ }));
    const result = await send(bot, "<b>q</b>", keyboard);
    expect(result).toMatchObject({
      sent: 2,
      failed: 0,
      total: 2,
      first: { target: "1", ref: "10" },
    });
    expect(sendMessage).toHaveBeenCalledWith("1", "<b>q</b>", {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  it("키보드 경로도 네트워크 오류를 재시도한다 — 4회 실패 후 집계 · first 는 첫 성공 (의도 변경 · 003 §4-1(a))", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1,2");
    vi.useFakeTimers();
    const { bot, sendMessage } = fakeBot(async (chatId) => {
      if (chatId === "1") throw networkError("ETIMEDOUT");
      return { message_id: 7 };
    });
    const pending = send(bot, "x", keyboard);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({
      sent: 1,
      failed: 1,
      total: 2,
      first: { target: "2", ref: "7" },
    });
    expect(sendMessage).toHaveBeenCalledTimes(5);
  });

  it("모두 실패하면 first 는 undefined 다", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    const { bot } = fakeBot(async () => {
      throw new Error("x");
    });
    const result = await send(bot, "x", keyboard);
    expect(result.first).toBeUndefined();
    expect(result).toMatchObject({ sent: 0, failed: 1, total: 1 });
  });

  it("HTML 파싱 실패 → plain 으로 재전송하되 keyboard 는 유지한다 (신규 · 1a-3 S-2)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    let calls = 0;
    const { bot, sendMessage } = fakeBot(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Bad Request: can't parse entities");
      return { message_id: 3 };
    });
    const result = await send(bot, "<b>A &amp; B</b>", keyboard);
    expect(result).toMatchObject({ sent: 1, first: { target: "1", ref: "3" } });
    // 엔티티는 디코드하지 않는다 (Q10-P ① 태그-only) — plain 폴백에 리터럴로 남는다
    expect(sendMessage.mock.calls[1]).toEqual(["1", "A &amp; B", { reply_markup: keyboard }]);
  });

  it("4096 초과 + keyboard → keyboard 는 마지막 청크에만 · first.ref 는 마지막 청크 (신규 · Q10-L ①)", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
    let id = 10;
    const { bot, sendMessage } = fakeBot(async () => ({ message_id: id++ }));
    const result = await send(bot, "a".repeat(5000), keyboard);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][2]).toEqual({ parse_mode: "HTML" });
    expect(sendMessage.mock.calls[1][2]).toEqual({ parse_mode: "HTML", reply_markup: keyboard });
    expect(result.first).toEqual({ target: "1", ref: "11" });
  });
});

describe("호출부 6건 — label 'bot' · first.ref 저장 (신규 · #48 I2)", () => {
  const db = vi.mocked(prisma, true);

  function failingBot() {
    return fakeBot(async () => {
      throw new Error("Forbidden: bot was blocked by the user");
    });
  }

  function expectBotLabelOnly(expectedFailures: number) {
    const logs = errorLogs();
    expect(logs.filter((l) => l.startsWith("[bot] 메시지 전송 실패"))).toHaveLength(expectedFailures);
    expect(logs.some((l) => l.startsWith("[notify]"))).toBe(false);
  }

  const payload = {
    date: "2026-09-30",
    base: { source: "plan", type: "tempo", distanceKm: 10, pace: "5:00", planId: "p1" },
    recommendation: {
      type: "easy",
      distanceKm: 6,
      paceRange: { min: "6:00", max: "6:30" },
      adjusted: true,
      adjustmentReason: "피로 & 부하",
    },
    factors: {
      readiness: { score: 40, label: "low" },
      injury: { score: 70, label: "high" },
      plan: { hasActivePlan: true, todayWorkoutExists: true, todayIsRestPlanned: false, lthrPaceSource: "x" },
    },
    rationale: "r",
  };

  function arrangeProposal() {
    db.userProfile.findFirst.mockResolvedValue({ autoAdjustEnabled: true } as never);
    db.trainingWorkout.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: "w1",
        type: "tempo",
        distanceKm: 10,
        paceSecPerKm: 300,
        zone: null,
        intervalDesc: null,
        notes: null,
      } as never);
    vi.mocked(recommendTodayWorkout).mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(payload) }],
    } as never);
    db.workoutAdjustment.create.mockResolvedValue({ id: "adj1" } as never);
    db.workoutAdjustment.update.mockResolvedValue({} as never);
    db.aIAdvice.create.mockResolvedValue({} as never);
  }

  function arrangeSnoozed() {
    db.workoutAdjustment.updateMany.mockResolvedValue({ count: 1 } as never);
    db.workoutAdjustment.findMany.mockResolvedValue([
      {
        id: "adj9",
        proposedType: "easy",
        proposedDistanceKm: 6,
        proposedPaceSecPerKm: 370,
        proposedZone: null,
        proposedIntervalDesc: null,
        reason: {},
      },
    ] as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "1");
  });

  it("scheduler 리포트 전송·에러 문구 전송 (호출 2건) 이 [bot] 으로 로그한다", async () => {
    vi.mocked(generateMorningReport).mockResolvedValue("hi");
    const { bot, sendMessage } = failingBot();
    startBotScheduler(bot);
    const morning = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
    await morning();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(String(sendMessage.mock.calls[1][1])).toContain("모닝 리포트 생성 실패");
    expectBotLabelOnly(2);
  });

  it("auto-adjust 제안(키보드)·에러 문구 전송 (호출 2건) 이 [bot] 으로 로그한다", async () => {
    arrangeProposal();
    const { bot, sendMessage } = failingBot();
    await runAutoAdjustProposal(bot);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][2]).toMatchObject({ parse_mode: "HTML", reply_markup: expect.anything() });
    expect(String(sendMessage.mock.calls[1][1])).toContain("Auto-adjust 알림 실패");
    expectBotLabelOnly(2);
  });

  it("auto-adjust 제안 성공 → first.ref·target 이 telegramMessageId·ChatId 로 그대로 저장된다", async () => {
    arrangeProposal();
    const { bot } = fakeBot(async () => ({ message_id: 42 }));
    await runAutoAdjustProposal(bot);
    expect(db.workoutAdjustment.update).toHaveBeenCalledWith({
      where: { id: "adj1" },
      data: { telegramMessageId: "42", telegramChatId: "1" },
    });
  });

  it("auto-adjust-cron 스누즈 재전송 실패가 [bot] 으로 로그한다", async () => {
    arrangeSnoozed();
    const { bot, sendMessage } = failingBot();
    await runAutoAdjustMaintenance(bot);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][2]).toMatchObject({ reply_markup: expect.anything() });
    expectBotLabelOnly(1);
  });

  it("auto-adjust-cron 스누즈 재전송 성공 → first.ref·target 이 그대로 저장된다", async () => {
    arrangeSnoozed();
    const { bot } = fakeBot(async () => ({ message_id: 77 }));
    await runAutoAdjustMaintenance(bot);
    expect(db.workoutAdjustment.updateMany).toHaveBeenLastCalledWith({
      where: { id: "adj9", decision: "snoozed" },
      data: { decision: "pending", snoozeUntil: null, telegramMessageId: "77", telegramChatId: "1" },
    });
  });

  it("admin-alerts 관리자 alert 전송 실패가 [bot] 으로 로그하고 예약을 해제한다", async () => {
    db.systemAlertState.updateMany.mockResolvedValue({ count: 1 } as never);
    db.systemAlertState.deleteMany.mockResolvedValue({ count: 1 } as never);
    const { bot, sendMessage } = failingBot();
    await notifyClaudeAuthExpiredIfNeeded(bot, new Error("Please run /login · authentication failed"));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expectBotLabelOnly(1);
    expect(db.systemAlertState.deleteMany).toHaveBeenCalledTimes(1);
  });
});
