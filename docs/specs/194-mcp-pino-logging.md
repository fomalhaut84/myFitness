# M#194: MCP 구조화 로깅 (pino + KST rotation + crash handler)

- **작성일**: 2026-07-08
- **타입**: chore/infra
- **참조**: myFinance PR #408 (Phase 32-C)
- **선행**: #180 (MCP HTTP transport), v2.6.x

## 1. 목적

MCP 서버의 `console.log/error` 자유 문자열 로그 → pino 구조화 JSON 로그. Tool 호출별 traceId/latency/status/args, HTTP 요청 흐름, 세션 이벤트, 크래시 stack 을 파일 tee 로 남겨 사후 분석 가능.

## 2. 요구사항 (F1~F15)

- [x] F1: `src/mcp/logger.ts` pino instance (multistream: stdout|stderr + optional file tee).
- [x] F2: stdio 모드 → stderr (JSON-RPC 채널 보호).
- [x] F3: `MCP_LOG_TEE_FILE=1` → `logs/mcp-YYYY-MM-DD.log` (KST 기준).
- [x] F4: KST 자정 감지 rotation (5분 주기 setInterval).
- [x] F5: 14일 retention (부팅/rotation 시 정리).
- [x] F6: redact password/token/secret/apiKey/jwt/DATABASE_URL/TELEGRAM_BOT_TOKEN.
- [x] F7: `newTraceId()` (uuid 8자), `summarizeArgs(maxLen=200)`, `installCrashHandlers()`.
- [x] F8: uncaughtException + unhandledRejection 둘 다 flush + `setTimeout(exit(1), 100)`. 이중 install 가드.
- [x] F9: factory 안 `server.tool` monkey-patch — 자동 계측.
- [x] F10: 3분류 로그 (tool_call / tool_call_reported_error / tool_call_sdk_error).
- [x] F11: `attachToolCallInstrumentation(transport)` + AsyncLocalStorage tracking.
- [x] F12: `console.*` → `logger.*` 전환 (transport_ready / session_initialized / session_closed / session_sweep / http_request / http_server_error / shutdown_started / http_server_closed).
- [x] F13: ecosystem MCP env 에 `MCP_LOG_TEE_FILE=1`.
- [x] F14: package.json — pino dep + esbuild `--external:pino --external:pino-abstract-transport --external:sonic-boom --external:thread-stream`.
- [x] F15: `.gitignore` `/logs/` — 이미 존재.

## 3. 변경 파일

- `src/mcp/logger.ts` (신규)
- `src/mcp/server.ts` — monkey-patch, attachToolCallInstrumentation, logger 치환, main installCrashHandlers
- `package.json` — pino dep + esbuild external
- `ecosystem.config.js` — MCP_LOG_TEE_FILE
- `docs/specs/194-mcp-pino-logging.md` (본 문서)

## 3-A. 회귀 시나리오

- **`MCP_TRANSPORT=""` (빈 문자열, rollback 시나리오)**: server 와 logger 둘 다 stdio 모드로 판정해야 함. `??` 는 empty string 통과 → 두 모듈 split-brain (server=stdio, logger=http) → stdio 서버가 stdout 으로 로그를 보내 MCP JSON-RPC 채널 오염.
  - **Fix**: `isStdioMode()` shared helper (`logger.ts`) 로 통일 (`||` 사용).
  - **검증**:
    ```
    $ MCP_TRANSPORT="" node dist/mcp/server.cjs
    → stderr 에 {"transport":"stdio","msg":"transport_ready"} (stdout 아님)
    ```

## 4. 로컬 검증

```
$ MCP_TRANSPORT=http MCP_PORT=4399 MCP_LOG_TEE_FILE=1 node dist/mcp/server.cjs
{"level":"info","time":"...","pid":21606,"service":"mcp","transport":"http","host":"127.0.0.1","port":4399,"msg":"transport_ready"}

$ curl http://127.0.0.1:4399/health
{"ok":true,"uptime":2.02,"sessions":0,"version":"1.0.0"}

$ ls logs/
mcp-2026-07-08.log

$ kill -TERM <pid>
{"level":"info","...","signal":"SIGTERM","activeSessions":0,"msg":"shutdown_started"}
{"level":"info","...","msg":"http_server_closed"}
```

3-check (lint / typecheck / build) 통과.

## 5. 검증 (배포 후)

- `pm2 logs myfitness-mcp` JSON 구조화 로그
- `logs/mcp-YYYY-MM-DD.log` 파일 생성 확인
- Claude CLI → `get_activities` 등 호출 → `tool_call` 로그 (traceId, latency_ms, status=ok)
- 다음날 자정 로그 rotation 확인
- 의도적 크래시 시 `uncaught_exception` fatal 로그 + stack 파일 남음

## 6. 롤백

- pm2 env 에서 `MCP_LOG_TEE_FILE` 제거 (파일 tee 만 비활성)
- 완전 되돌리기 → git revert
