// pleiades 1a-3 (pleiades#95 · 003 §5-1): 아웃바운드 알림을 @pleiades/notify 파사드로 보낸다.
// 구 send.ts(sendToAll / sendToAllWithKeyboard) 를 대체 — 재시도 [2000, 8000, 30000] · HTML→plain 폴백 ·
// 4096 초과 줄 경계 분할(Q10-L ①) 은 패키지 코어가 소유하고, 키보드 전송도 같은 정책을 탄다(003 §4-1(a)).
// 수신자는 fit 규칙 그대로 TELEGRAM_ALLOWED_CHAT_IDS (Route.ALLOWED · fit 은 ADMIN 미매핑 — 003 §4-2 Q25 하위 A).

import type { Bot } from "grammy";
import {
  createNotifier,
  createTelegramTransport,
  csvEnv,
  type Notifier,
  type NotifyContext,
} from "@pleiades/notify";

/**
 * 호출부 공통 로그 컨텍스트 — `[bot] 전송 재시도 …` · `[bot] 메시지 전송 실패 …` 형식 보존(#48 I2 · U-5).
 * 빠뜨리면 패키지 기본값 `[notify]` 가 찍힌다.
 */
export const BOT_NOTIFY_CTX: NotifyContext = Object.freeze({ label: "bot" });

/** 봇 인스턴스로 파사드를 만든다. 호출부가 이미 `bot` 을 인자로 받으므로 `bot.api` 를 그대로 넘긴다(D-2). */
export function notifierFor(bot: Bot): Notifier {
  return createNotifier({
    transport: createTelegramTransport({ api: bot.api }),
    targets: { ALLOWED: csvEnv("TELEGRAM_ALLOWED_CHAT_IDS") },
  });
}
