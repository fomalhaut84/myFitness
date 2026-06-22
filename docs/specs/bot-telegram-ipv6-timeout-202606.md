# 텔레그램 봇 IPv6 ETIMEDOUT 장애 + 토큰 로그 노출 대응

- **작성일**: 2026-06-22
- **타입**: bug (P1)
- **영향 범위**: `myfitness-bot` 프로세스의 cron 리포트(모닝/이브닝/주간), AI 응답 등 `sendMessage` 호출 전반
- **관련 릴리즈**: 핫픽스 대상 (필요 시 후속 패치 릴리즈)

## 1. 문제 정의

### 1.1 증상

운영 서버(Ubuntu, PM2)에서 텔레그램 봇의 cron 리포트 전송이 06-19부터 매일 실패. PM2 로그(`pm2 logs myfitness-bot`)에 동일 패턴 반복:

```
[bot] 메시지 전송 실패 (<chatId>): HttpError: Network request for 'sendMessage' failed!
  ...
  error: FetchError: request to https://api.telegram.org/bot<TOKEN>/sendMessage failed, reason:
    type: 'system', errno: 'ETIMEDOUT', code: 'ETIMEDOUT'
[bot] plain text fallback도 실패 (<chatId>): HttpError: ...
[bot-cron] <리포트명> 에러: sendToAll: 모든 채팅 전송 실패 (failed=1/total=1)
```

발생 시각이 cron 트리거(08:00 / 23:00 / 월요일 07:00 KST)에 일치.

### 1.2 진단 결과 (서버 검증)

| 시도 | 결과 |
|---|---|
| `curl -v https://api.telegram.org/...` | 200 OK (IPv4 fallback 후 성공) |
| `curl -4 https://api.telegram.org/` | 302 (IPv4 정상) |
| `curl -6 https://api.telegram.org/` | `Immediate connect fail ... Network is unreachable` |
| `dig api.telegram.org` | `149.154.166.110` |
| `dig AAAA api.telegram.org` | `2001:67c:4e8:f004::9` |
| `iptables -L OUTPUT` | ufw 기본, 차단 없음 |

→ **결정적 원인**: 서버에 IPv6 라우트가 없음. `dns.lookup`이 AAAA를 먼저 반환 → Node.js의 `node-fetch`가 IPv6로 connect 시도 → 커널이 ENETUNREACH를 반환하지만 node-fetch 경로에서 ETIMEDOUT으로 전파됨. curl은 Happy Eyeballs로 즉시 IPv4 fallback 하지만 node-fetch는 그렇지 못함.

### 1.3 추가 발견: 봇 토큰이 PM2 로그에 평문으로 기록

- grammy v1.42의 `HttpError` 자체는 `sensitiveLogs: false` 기본값 덕분에 토큰 노출 안 함.
- 그러나 `HttpError`가 inner `FetchError`를 `error` 속성으로 가지고 있고, 해당 `FetchError`의 메시지는 요청 URL(`/bot<TOKEN>/sendMessage`)을 그대로 포함.
- `console.error(error)`가 inner 에러 객체까지 dump → PM2 stderr → 디스크 로그 파일에 평문 토큰 남음.
- 토큰 회수·재발급은 운영 측에서 별도 진행. 본 PR은 **이후 발생하는 로그에 다시 노출되지 않도록 마스킹** 책임만 담당.

### 1.4 부수 문제: 재시도 없음 + 잘못 설계된 fallback

`src/bot/notifications/scheduler.ts:22-45` `sendToAll`:

- `bot.api.sendMessage` 1회 실패 시 즉시 fallback으로 동일 채팅에 plain text 재시도. 백오프 없음.
- fallback의 목적은 HTML parse 실패 대응이지만, 네트워크 에러 시에도 같은 catch에 들어가 의미 없는 재시도가 됨.
- cron당 1회 실패 = 그 리포트 영영 누락. 자동 복구 경로 없음.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 봇이 `api.telegram.org`로 연결할 때 IPv6를 시도하지 않음 (IPv4 강제).
- [ ] **F2**: `sendMessage` 호출의 네트워크 타임아웃을 기본 500s에서 60s로 단축 (long-poll 기본 30s 위에 안전 마진).
- [ ] **F3**: `sendToAll`에 네트워크 일시 실패 대응 재시도(지수 백오프, 시도 사이 sleep 2s/8s/30s, 총 4회 시도 = 초기 + 3 재시도).
- [ ] **F4**: HTML 파싱 실패 fallback과 네트워크 재시도 로직을 분리.
  - HTML parse 에러(Telegram이 명시적으로 400 반환 등)일 때만 plain text fallback.
  - 네트워크 에러일 때는 plain text 재시도 무의미 → 동일 페이로드로 재시도만.
- [ ] **F5**: 에러 로깅 시 봇 토큰 마스킹. 정규식 `bot\d+:[A-Za-z0-9_-]+` → `bot<REDACTED>` 로 치환한 메시지를 출력.
- [ ] **F6**: 에러 객체 dump 시 `cause` / `error` (grammy HttpError의 inner FetchError 포함) 도 마스킹 대상.

### 2.2 비기능 요구사항

- [ ] 기존 동작(HTML parse 실패 → plain text fallback) 호환 유지.
- [ ] 단일 사용자(`TELEGRAM_ALLOWED_CHAT_IDS`에 chat id 1개) 시나리오에서도 정상 동작.
- [ ] cron 시각에 봇 응답성에 영향 주지 않는 수준의 추가 지연(최악 약 40s).

## 3. 기술 설계

### 3.1 IPv4 강제 + 타임아웃 단축 (F1, F2)

`src/bot/index.ts`:

```ts
import { Bot } from "grammy";
import { Agent } from "https";

const ipv4Agent = new Agent({ family: 4, keepAlive: true });

export function getBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN 환경변수가 필요합니다.");

  const bot = new Bot(token, {
    client: {
      baseFetchConfig: { agent: ipv4Agent },
      timeoutSeconds: 30,
    },
  });
  // ... (기존 미들웨어/커맨드 등록)
  return bot;
}
```

- `family: 4`는 node-fetch의 `https.Agent`가 DNS lookup 시 IPv4만 요청하게 함.
- `keepAlive: true`로 cron 시점에 TCP/TLS 핸드셰이크 비용 절감.
- `timeoutSeconds: 60`은 grammy `bot.start()` 의 long-polling 기본 timeout(30s) 위에 안전 마진. 30초로 설정하면 idle 봇이 매 long-poll round마다 abort → 재연결 루프에 빠짐. cron `sendMessage` 호출은 60s 이내 응답되므로 충분히 짧음.

### 3.2 sendToAll 재시도 + 백오프 분리 (F3, F4)

`src/bot/notifications/scheduler.ts`:

```ts
const RETRY_DELAYS_MS = [2000, 8000, 30000]; // 3회 시도

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Telegram HTML 파싱 실패만 fallback 대상. 네트워크 에러는 재시도 루프에서 처리. */
function isHtmlParseError(err: unknown): boolean {
  const desc = err instanceof Error ? err.message : String(err);
  // grammy GrammyError: 400 Bad Request: can't parse entities ...
  return /can't parse entities|Bad Request:.*entit/i.test(desc);
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const codes = ["ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EAI_AGAIN", "ECONNREFUSED"];
  const root = (err as { error?: { code?: string }; code?: string }).error?.code
    ?? (err as { code?: string }).code;
  return root !== undefined && codes.includes(root);
}

async function sendOneWithRetry(bot: Bot, chatId: string, text: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const msg = text.length > MAX_MSG ? text.slice(0, MAX_MSG - 3) + "..." : text;
      await bot.api.sendMessage(chatId, msg, { parse_mode: "HTML" });
      return;
    } catch (err) {
      lastErr = err;
      if (isHtmlParseError(err)) {
        const plain = text.replace(/<[^>]*>/g, "").slice(0, MAX_MSG);
        await bot.api.sendMessage(chatId, plain);
        return;
      }
      if (!isNetworkError(err) || attempt === RETRY_DELAYS_MS.length - 1) {
        throw err;
      }
      console.warn(
        `[bot] 전송 재시도 ${attempt + 1}/${RETRY_DELAYS_MS.length} (${chatId}, ${RETRY_DELAYS_MS[attempt]}ms 후): ${sanitizeError(err)}`
      );
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}
```

`sendToAll`은 채팅별로 `sendOneWithRetry` 호출, 에러 시 `console.error(... sanitizeError(err))` 형태로 로깅.

### 3.3 토큰 마스킹 유틸 (F5, F6)

신규 파일 `src/bot/utils/error.ts`:

```ts
const TOKEN_RE = /bot\d+:[A-Za-z0-9_-]+/g;

export function sanitizeMessage(msg: string): string {
  return msg.replace(TOKEN_RE, "bot<REDACTED>");
}

/** Error/cause 체인을 안전한 문자열로 직렬화 (토큰 마스킹 포함). */
export function sanitizeError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      parts.push(`${cur.name}: ${sanitizeMessage(cur.message)}`);
      const inner = (cur as { error?: unknown; cause?: unknown }).error
        ?? (cur as { cause?: unknown }).cause;
      cur = inner;
    } else if (typeof cur === "string") {
      parts.push(sanitizeMessage(cur));
      break;
    } else {
      try {
        parts.push(sanitizeMessage(JSON.stringify(cur)));
      } catch {
        parts.push("[unserializable]");
      }
      break;
    }
    depth++;
  }
  return parts.join(" | ");
}
```

- `Error.cause`(ES2022) 와 grammy의 비표준 `error` 프로퍼티 양쪽을 따라가며 메시지 누적.
- 깊이 5 제한으로 순환 참조 방어.
- JSON 직렬화 fallback도 마스킹 통과.

기존 `console.error("[bot] 메시지 전송 실패 ...", error)` → `console.error("[bot] 메시지 전송 실패 ...", sanitizeError(error))` 로 교체.

## 4. 변경 파일

- `src/bot/index.ts` — `Bot` 생성 시 `client` 옵션 추가
- `src/bot/notifications/scheduler.ts` — 재시도 로직, 로그 sanitize
- `src/bot/utils/error.ts` *(신규)* — 토큰 마스킹 유틸
- `docs/roadmap.md` — 유지보수/보안 섹션 항목 추가

## 5. 테스트 계획

### 5.1 단위 테스트 — 별도 이슈로 분리

현재 레포에 테스트 프레임워크(jest/vitest)가 없고 `npm run test` 스크립트도 미정의. 기존 코드 전반에 단위 테스트 부재 상태이므로, 본 패치에서 테스트 인프라 도입은 scope 초과. 패치 검증은 `lint + typecheck + build` 3종으로 한정하고, 단위 테스트 작성은 **테스트 인프라 도입 후속 이슈**(예: vitest 도입 + bot/utils 우선 커버)로 분리.

핵심 sanitize/재시도 로직은 작고 결정적이라 정적 검사 + 운영 로그로 회귀 감지 가능.

### 5.2 통합 검증 (배포 후 사용자)

```bash
pm2 restart myfitness-bot
sleep 3
pm2 logs myfitness-bot --lines 50 --nostream | grep -E "초기화 완료|알림 스케줄"
# 다음 cron 시각(08:00 / 23:00 / 07:00 KST) 도래 후 로그 확인
pm2 logs myfitness-bot --lines 200 --nostream | grep -E "\[bot-cron\]|메시지 전송"
```

기대: `메시지 전송 실패` 0건, `[bot-cron] ... 전송 완료` 출력.

## 6. 제외 사항

- **시스템 IPv6 라우팅 복원 작업 — 본 패치 범위 아님**. 호스팅/ISP 측 이슈로 별도 대응. 본 패치는 IPv6 환경이 다시 정상화되어도 안전(서버가 IPv4 우선 사용).
- **봇 토큰 회수·재발급** — 운영자가 BotFather에서 직접 수행. `.env` 갱신 후 `pm2 restart myfitness-bot`.
- **장기 모니터링 / Alertmanager 연동** — 추후 별도 이슈.
- **Telegram API 외의 외부 호출(가민 API, Anthropic API 등) IPv6 정합** — 본 PR 범위 아님. 필요 시 후속 이슈.

## 7. 롤백 계획

- `git revert <merge-sha>` 후 `pm2 restart myfitness-bot`.
- 환경변수/DB 마이그레이션 없음 → 원복 시 부작용 없음.
