// #253: sendToAll / sendToAllWithKeyboard 을 별도 모듈로 분리.
// scheduler.ts 와 claude-auth-monitor.ts 가 이 함수를 모두 import 하는데, scheduler.ts
// 에 두면 claude-auth-monitor.ts → scheduler.ts → claude-auth-monitor.ts 순환 import
// 위험. 순수 send helper 라 별도 파일이 자연.

import type { Bot, InlineKeyboard } from "grammy";
import { sanitizeError, isNetworkError, isHtmlParseError } from "../utils/error";

const MAX_MSG = 4096;
const RETRY_DELAYS_MS = [2000, 8000, 30000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export interface SendResult {
  sent: number;
  failed: number;
  total: number;
}

export interface SendKeyboardResult extends SendResult {
  /** 첫 번째 성공 전송의 chatId + messageId (callback 매칭용). 모두 실패 시 undefined. */
  first?: { chatId: string; messageId: number };
}

function getChatIds(): string[] {
  return (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string): string {
  return text.length > MAX_MSG ? text.slice(0, MAX_MSG - 3) + "..." : text;
}

async function sendOneWithRetry(
  bot: Bot,
  chatId: string,
  htmlText: string,
): Promise<void> {
  const html = truncate(htmlText);
  const plain = truncate(htmlText.replace(/<[^>]*>/g, ""));
  let useHtml = true;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      if (useHtml) {
        await bot.api.sendMessage(chatId, html, { parse_mode: "HTML" });
      } else {
        await bot.api.sendMessage(chatId, plain);
      }
      return;
    } catch (err) {
      lastErr = err;
      // HTML parse 에러 → 같은 시도 횟수로 plain 모드 전환 (백오프 없이 즉시 재시도)
      if (useHtml && isHtmlParseError(err)) {
        useHtml = false;
        attempt--;
        continue;
      }
      if (!isNetworkError(err) || attempt === MAX_ATTEMPTS - 1) {
        throw err;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[bot] 전송 재시도 ${attempt + 1}/${MAX_ATTEMPTS} (${chatId}, ${delay}ms 후): ${sanitizeError(err)}`,
      );
      await sleep(delay);
    }
  }
  throw lastErr ?? new Error("sendOneWithRetry: 재시도 모두 실패 (원인 미상)");
}

export async function sendToAll(bot: Bot, text: string): Promise<SendResult> {
  const ids = getChatIds();
  let sent = 0;
  let failed = 0;
  for (const chatId of ids) {
    try {
      await sendOneWithRetry(bot, chatId, text);
      sent++;
    } catch (err) {
      failed++;
      console.error(`[bot] 메시지 전송 실패 (${chatId}): ${sanitizeError(err)}`);
    }
  }
  return { sent, failed, total: ids.length };
}

/**
 * inline keyboard 첨부 전송. HTML fallback 없음 (HTML 이 실패해도 keyboard 는 유지).
 * 재시도 로직 없이 단순 전송 — 재시도 필요 시 개별 확장.
 * 첫 성공 결과만 캡처 (M13 Phase 2 는 사용자 1명 기준).
 */
export async function sendToAllWithKeyboard(
  bot: Bot,
  text: string,
  keyboard: InlineKeyboard,
): Promise<SendKeyboardResult> {
  const ids = getChatIds();
  const html = truncate(text);
  let sent = 0;
  let failed = 0;
  let first: SendKeyboardResult["first"];
  for (const chatId of ids) {
    try {
      const msg = await bot.api.sendMessage(chatId, html, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      sent++;
      if (!first) first = { chatId, messageId: msg.message_id };
    } catch (err) {
      failed++;
      console.error(
        `[bot] keyboard 메시지 전송 실패 (${chatId}): ${sanitizeError(err)}`,
      );
    }
  }
  return { sent, failed, total: ids.length, first };
}
