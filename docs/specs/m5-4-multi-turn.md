# M5-4: 멀티턴 컨텍스트 강화 (채널별 sessionId + TTL)

- **작성일**: 2026-06-23
- **타입**: feature (P1)
- **마일스톤**: M5 (`docs/specs/m5-overview.md`) — 마지막
- **백엔드 전용**

## 1. 목적

기존 `currentSessionId` 가 모듈 전역 단일 변수 → 봇 프로세스에서 사용자 채팅과 cron 리포트가 같은 세션 공유 → 컨텍스트 오염 + 토큰 비대화. 채널별 세션 분리 + TTL/토큰 한도로 자동 정리.

## 2. 호출자 분석

| 호출자 | 채널 | multi-turn 의미 | 현재 동작 |
|---|---|---|---|
| `/api/ai` POST | `web` | O — 사용자 채팅 연속성 | 전역 sessionId 사용 |
| 봇 `/ai` 커맨드 | `telegram` | O — 사용자 텔레그램 채팅 | 전역 sessionId 사용 |
| 모닝/이브닝 cron | `cron-morning` / `cron-evening` | X — 단발, 매번 fresh 권장 | 전역 sessionId 사용 (오염 원인) |
| 주간 cron | `cron-weekly` | X — 단발 | 전역 sessionId 사용 |
| UI 재생성 (POST /api/reports) | (=cron 채널 공유) | X | 전역 sessionId 사용 |

**문제 시나리오**: 봇 프로세스에서 사용자가 `/ai 컨디션 어때?` 후 5분 뒤 cron 모닝 리포트 트리거 → resume으로 이전 세션 컨텍스트(컨디션 질문)에 모닝 리포트 prompt 이어붙음 → AI 응답이 양쪽 의도 섞임.

## 3. 요구사항

### 3.1 기능 요구사항

- [ ] **F1**: `src/lib/ai/session-store.ts` 신규 — 채널별 sessionId + lastActiveAt + cumulativeInputTokens 보관.
  - `getSession(channel: string): string | null` — TTL/토큰 한도 초과 시 자동 reset 후 null 반환
  - `setSession(channel: string, sessionId: string, addInputTokens?: number): void` — 누적 토큰 갱신
  - `resetSession(channel: string): void`
  - `resetAll(): void` — 모든 채널 reset (디버깅/긴급)
- [ ] **F2**: `askAdvisor(prompt, { channel?: string })` 시그니처 확장. `channel` 기본값 `"default"` (후방 호환).
- [ ] **F3**: TTL = 6시간 무활동, 토큰 한도 = 100,000 누적 입력 토큰. 둘 중 하나 초과 시 자동 reset.
- [ ] **F4**: 호출자별 채널 명시:
  - `/api/ai` POST → `"web"`
  - `/api/ai` `action: "reset"` → `resetSession("web")`
  - 봇 `/ai` → `"telegram"`, `/reset` → `resetSession("telegram")`
  - daily-report `morning_report` → `"cron-morning"`, **매 호출 직전 `resetSession(channel)` 자동 호출** (단발 동작 강제)
  - daily-report `evening_report` → `"cron-evening"` (동일)
  - weekly-report → `"cron-weekly"` (동일)
- [ ] **F5**: 기존 export 호환 — `resetSession()` (인자 없음): 모든 채널 reset. `getSessionId()`: `"default"` 채널 sessionId 반환.
- [ ] **F6**: cron 채널은 단발 강제 — `setSession` 후에도 다음 호출 직전 reset. 사실상 매번 fresh 세션. (cache는 prompt prefix 기반이라 sessionId 무관)

### 3.2 비기능

- 메모리 사용량 — 채널 5-10개 × 작은 entry. 무관.
- TTL/토큰 검증은 `getSession` 호출 시 lazy. 백그라운드 cleanup 불필요.
- 토큰 카운트 = Claude CLI 응답 JSON의 `usage.input_tokens` (있을 때). 없으면 0 추가 (보수적).

## 4. 기술 설계

### 4.1 session-store.ts

```ts
const TTL_MS = 6 * 60 * 60 * 1000;
const TOKEN_LIMIT = 100_000;

interface SessionEntry {
  sessionId: string;
  lastActiveAt: number;
  cumulativeInputTokens: number;
}

const store = new Map<string, SessionEntry>();

export function getSession(channel: string): string | null {
  const entry = store.get(channel);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.lastActiveAt > TTL_MS) {
    store.delete(channel);
    return null;
  }
  if (entry.cumulativeInputTokens > TOKEN_LIMIT) {
    store.delete(channel);
    return null;
  }
  return entry.sessionId;
}

export function setSession(channel: string, sessionId: string, addInputTokens = 0): void {
  const existing = store.get(channel);
  store.set(channel, {
    sessionId,
    lastActiveAt: Date.now(),
    cumulativeInputTokens: (existing?.cumulativeInputTokens ?? 0) + Math.max(0, addInputTokens),
  });
}

export function resetSession(channel: string): void {
  store.delete(channel);
}

export function resetAll(): void {
  store.clear();
}
```

### 4.2 claude-advisor.ts

```ts
import * as SessionStore from "./session-store";

export interface AskOptions {
  channel?: string;
}

export async function askAdvisor(prompt: string, options: AskOptions = {}): Promise<ClaudeResponse> {
  const channel = options.channel ?? "default";
  const sessionId = SessionStore.getSession(channel);
  // ... 기존 빌드
  if (sessionId) {
    args.push("--resume", sessionId);
  } else {
    // 새 세션 분기 (M5-3 그대로)
  }
  // 호출 후
  if (parsed.session_id) {
    const inputTokens = parsed.usage?.input_tokens ?? 0;
    SessionStore.setSession(channel, parsed.session_id, inputTokens);
  }
  return { result, sessionId: parsed.session_id ?? null, duration_ms };
}

// 호환 wrapper
export function resetSession(channel?: string): void {
  if (channel === undefined) SessionStore.resetAll();
  else SessionStore.resetSession(channel);
}

export function getSessionId(channel = "default"): string | null {
  return SessionStore.getSession(channel);
}
```

기존 모듈 전역 `let currentSessionId` 제거.

### 4.3 호출자 변경

```ts
// route.ts (API /ai)
askAdvisor(prompt, { channel: "web" });
resetSession("web");
getSessionId("web");

// ai.ts (bot)
askAdvisor(question, { channel: "telegram" });
resetSession("telegram");

// daily-report.ts
async function generateReport(category, prompt, force, reportDate) {
  // ...
  const channel = `cron-${category.replace("_report", "")}`; // cron-morning / cron-evening
  resetSession(channel);  // 단발 강제 — 매번 fresh
  const { result } = await askAdvisor(prompt, { channel });
  // ...
}

// weekly-report.ts
resetSession("cron-weekly");
const { result } = await askAdvisor(WEEKLY_REPORT_PROMPT, { channel: "cron-weekly" });
```

## 5. 변경 파일

- `src/lib/ai/session-store.ts` *(신규)*
- `src/lib/ai/claude-advisor.ts` — channel 옵션 + SessionStore 사용 + 기존 export 호환
- `src/app/api/ai/route.ts` — channel "web"
- `src/bot/commands/ai.ts` — channel "telegram"
- `src/lib/daily-report.ts` — 단발 reset + channel cron-morning/cron-evening
- `src/lib/weekly-report.ts` — 단발 reset + channel cron-weekly

## 6. 테스트 계획

- `npm run lint && npm run typecheck && npm run build` 3종.
- 운영 적용 후 시나리오 확인:
  - 봇에서 `/ai 컨디션` → 5분 뒤 모닝 cron 트리거 → 모닝 리포트가 컨디션 컨텍스트 섞이지 않는지
  - web에서 채팅 3-4턴 → 봇에서 별개 질문 → 두 채널 독립
  - 6h 후 web 채팅 다시 → 자동 새 세션

## 7. 제외 사항

- AI 채팅 페이지 "새 대화" 버튼 — **이미 구현됨** (`src/app/ai/page.tsx:63` `handleResetSession`).
- `_user_id` 기반 채널 (멀티유저) — 단일 사용자 시스템이라 불필요.
- 토큰 측정 logging (별도 백로그)
- 세션 영속화 (재시작 후 sessionId 복원) — 메모리 상태 충분, 영속은 과한 작업.

## 8. 롤백

`git revert`. DB / 환경변수 영향 없음. 호환 wrapper로 외부 호출자 깨짐 없음.
