# M#180: MCP 서버를 pm2 daemon 화 (HTTP transport)

- **작성일**: 2026-07-07
- **타입**: chore/infra
- **참조**: myFinance PR #406 (PoC), #407 (Phase 32-B 정식 통합)

## 1. 목적

MCP 서버 (`dist/mcp/server.cjs`) 를 stdio subprocess (Claude CLI 매 호출마다 fork/kill) → **상시 상주 HTTP 서버 (pm2 앱 `myfitness-mcp`)** 로 승격.

효과:

- 매 호출당 Node 부팅 + Prisma 초기화 비용 (~500ms) 제거
- `pm2 logs myfitness-mcp` 로 tool 호출 트래킹 (사후 진단)
- 크래시 자동 복구 (pm2 autorestart)
- Prisma 커넥션 pool 재사용

## 2. 참고 (myFinance)

- **PR #406**: PoC. Multi-session stateful 이 정답 (Stateless 는 Claude CLI 가 tools/list 진행 안 함, 단일 transport 는 재초기화 reject)
- **PR #407**: 정식 통합. `createMyFinanceMcpServer()` factory + `MCP_TRANSPORT` env 분기 + graceful shutdown

myFitness 도 동일 패턴 이식. **다만 포트는 4200 이 웹 예약이라 MCP 는 `4301` 사용.**

## 3. 요구사항

- [x] **F1**: `createMyFitnessMcpServer()` factory 로 전환. 세션마다 fresh 인스턴스.
- [x] **F2**: `MCP_TRANSPORT=stdio|http` env 로 모드 선택 (기본 stdio, 회귀 스위치).
- [x] **F3**: HTTP multi-session — `mcp-session-id` 헤더 라우팅, `sessionIdGenerator: randomUUID`.
- [x] **F4**: Idle sweeper — 30분 TTL, 5분 주기. `pickStaleSessions` 순수 함수로 분리.
- [x] **F5**: Graceful shutdown — SIGTERM → 활성 transport close → transports Map clear → httpServer.close → 15s 강제.
- [x] **F6**: `httpServer.on('error')` 로 listen 실패 즉시 종료 (PM2 backoff).
- [x] **F7**: `dotenv/config` 최상단 import — standalone 프로세스가 .env 를 스스로 로드.
- [x] **F8**: `ecosystem.config.js` 에 `myfitness-mcp` 앱 추가 (port 4301, kill_timeout 15s).
- [x] **F9**: `src/lib/ai/claude-advisor.ts` `ensureMcpConfig` → `type: "http", url: ...` 로 전환. `MCP_HTTP_URL` env override 지원.
- [x] **F10**: `package.json` build:mcp 를 staged (`.staged.cjs`) → activate (`fs.renameSync`) 2단계.
- [x] **F11**: `deploy/deploy.sh` MCP 먼저 재시작 → 20s retry health check → 실패 시 abort → 그 다음 web/bot.
- [x] **F12**: `src/mcp/session-utils.ts` — `pickStaleSessions`, `resolveSessionRequest` 순수 함수 (테스트 용이).

## 4. 포트 결정

- 웹: **4200** (그대로)
- MCP: **4301** — `MCP_PORT` env 로 override 가능
- 근거: 사용자 요청 (memory/project_ports.md) — 4200 은 다른 프로젝트 예약.

## 5. 변경 파일

- `src/mcp/server.ts` — factory + startStdio/startHttp
- `src/mcp/session-utils.ts` *(신규)*
- `src/lib/ai/claude-advisor.ts` — `ensureMcpConfig` HTTP 로 전환 + `MCP_SERVER_PATH` 상수 제거
- `src/lib/ai/mcp-config.json` — 참조용 정적 파일 갱신
- `ecosystem.config.js` — myfitness-mcp 앱 추가
- `package.json` — build:mcp staged/activate
- `deploy/deploy.sh` — MCP 먼저 + health check + 그 다음 web/bot

## 6. 롤백

`MCP_TRANSPORT` 미설정 시 stdio 모드로 동작. 회귀 스위치 유효.
- pm2 앱 삭제: `pm2 delete myfitness-mcp`
- stdio 로 즉시 롤백은 별도 커밋 or git revert 필요.

## 7. 검증 (배포 후)

1. `curl http://127.0.0.1:4301/health` → `{"ok":true,"sessions":0}`
2. `pm2 logs myfitness-mcp` 에 `session_initialized` 로그
3. `pm2 logs myfitness-bot` 의 `[askAdvisor]` 요약 유지 (동작 정상)
4. 이브닝 리포트 정상 도착

## 8. 후속

Phase B (별도 PR): pino 구조화 로깅 (myFinance PR #408 참조).
