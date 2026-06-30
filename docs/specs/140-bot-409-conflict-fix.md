# 봇 409 Conflict 중복 인스턴스 fix (PM2 deploy 패턴)

- **작성일**: 2026-06-30
- **타입**: bug (P1)
- **연관**: PR #139 (#138, unhandledRejection 차단), myFinance PR #357 (해결 패턴 원본)

## 1. 문제

운영 PM2 로그에 배포/restart 후 봇 시작 시마다 반복:

```
2026-06-XX HH:MM:00: [bot] standalone 프로세스 시작...
2026-06-XX HH:MM:02: [bot] standalone 프로세스 시작...     ← 2개 인스턴스
2026-06-XX HH:MM:02: GrammyError: Call to 'getUpdates' failed!
  (409: Conflict: terminated by other getUpdates request;
   make sure that only one bot instance is running)
```

증상: 배포 / restart 직후 봇이 잠시 죽었다 살아남. PM2 ↺ 카운트 비정상 증가 (myfitness-bot ↺ 8~9). 사용자 입력 손실 가능성.

## 2. 원인 분석 (myFinance #357 차용)

### 2.1 `pm2 startOrReload` + fork 단일 인스턴스 부조합

- `pm2 startOrReload` = 이미 실행 중이면 **graceful reload**
- `reload` 는 cluster 모드용 zero-downtime 패턴 — 새 워커 띄움 → ready → 옛 워커 종료
- 봇은 `instances: 1` 단일 fork 모드인데 reload 시도 시 PM2 가 새 인스턴스 spawn → **잠시 두 봇 동시 실행**
- 텔레그램 long polling 은 토큰당 1개만 허용 → 늦은 인스턴스가 `409 Conflict` 받고 종료
- `autorestart: true` 가 다시 살리려 시도하면서 텔레그램 측 polling 세션 정리 전에 재시도 → 충돌 반복

### 2.2 graceful shutdown 시간 부족

- `standalone.ts` 의 SIGTERM 핸들러는 `bot.stop()` 으로 정상 종료 시도 (PR #139에서 await 보장)
- 하지만 PM2 기본 `kill_timeout = 1600ms` — long-poll 끊는 시간 모자라 SIGKILL 강제
- 강제 종료 시 텔레그램 측 polling 세션이 잠시 살아있는 것처럼 남음

### 2.3 `max_restarts` 영구 stop 위험 (PR #139 설정 재검토)

PR #139에서 `min_uptime: '60s'` + `max_restarts: 10` 도입했으나:
- 봇이 알림 채널 단일 장애점 → 영구 stopped 상태가 되면 **무알람 = 더 큰 운영 위험**
- transient 외부 장애(텔레그램/네트워크 일시 outage)에서 자동 회복 불가
- myFinance #357 분석에서 같은 결론 — `max_restarts` 안 쓰고 `exp_backoff_restart_delay` 사용

## 3. 요구사항

- [ ] **F1**: 봇은 deploy 시 graceful reload 대신 **hard restart** (단일 인스턴스 보장)
- [ ] **F2**: PM2 가 봇에 더 긴 종료 유예 시간 제공 (`kill_timeout: 15000`)
- [ ] **F3**: crash loop 시 점차 늘어나는 재시도 간격 (`exp_backoff_restart_delay: 100`). 100ms → 200ms → ... 최대 15s. **무한 재시도** 라 transient 외부 장애 회복까지 기다림. PM2 default `max_restarts: 16` 명시적 override (`Number.MAX_SAFE_INTEGER`) 필요 — 그렇지 않으면 30s min_uptime 도달 못한 16회 실패 시 영구 stopped.
- [ ] **F4**: 안정성 기준 (`min_uptime: 30000`) — 30s 이상 살아있으면 정상 동작으로 간주.
- [ ] 웹 (Next.js) 은 그대로 `startOrReload` 유지 (stateless, zero-downtime 유지)

## 4. 변경

### `deploy/deploy.sh`

PR #139 의 `delete + start` 방식 유지. 두 가지 요건 동시 충족:
1. 단일 인스턴스 보장 (409 차단) — delete 후 start로 동시 실행 없음
2. ecosystem 옵션 변경 100% 반영 — PM2 process 완전 삭제 후 재등록해야 `kill_timeout`/`exp_backoff_restart_delay` 등 비-env 옵션이 갱신됨 (`pm2 startOrRestart`/`reload` 는 env만 갱신, 비-env 옵션 ignore — Codex P2 지적)

```bash
pm2 delete myfitness-bot 2>/dev/null || true
pm2 start ecosystem.config.js --only myfitness-bot
```

봇은 stateless라 1-2초 다운타임 무관.

**myFinance #357 차이**: 그 PR은 `startOrRestart` 사용 — ecosystem 옵션 갱신은 운영자가 한 번 수동 delete + start 해야 반영. 우리는 자동화로 갈음.

### `ecosystem.config.js` myfitness-bot 블록

```diff
-  min_uptime: '60s',
-  max_restarts: 10,
+  kill_timeout: 15000,
+  min_uptime: 30000,
+  exp_backoff_restart_delay: 100,
+  max_restarts: Number.MAX_SAFE_INTEGER,
```

`max_restarts` 명시 안 하면 PM2 default 16 적용 → exp_backoff 가 무한 보장 못 함. Codex 리뷰 P2 반영.

## 5. 검증

배포 후 PM2 로그에 봇 시작 메시지가 **한 번만** 찍히는지 확인:

```bash
pm2 logs myfitness-bot --lines 50
#   → [bot] standalone 프로세스 시작... (1회만)
#   → [bot] @starryjejufitnessbot 초기화 완료
#   → 409 Conflict 메시지 없음
```

배포 직전/직후 봇이 메시지 처리하는 동안에도 누락 없는지 확인:
- 배포 직전 텔레그램에 메시지 전송 → 응답 받는지
- 배포 중 (5~15초간) 추가 메시지 전송 → 재시작 후 응답 또는 long-poll backlog 처리되는지

## 6. 운영 주의

- `exp_backoff_restart_delay` 는 무한 재시도라 진짜 코드 버그 시에도 봇이 영구 죽지 않음. 다만 backoff 으로 간격이 점차 늘어 로그 폭증/리소스 낭비는 차단됨.
- 봇 자체가 알림 채널이므로 봇이 죽으면 알림이 멈추는 단일 장애점. 별도 health check / 외부 ping 모니터링 권장 (M5 마일스톤 후속 backlog).

## 7. 제외 사항

- 봇의 `bot.stop()` 자체 로직 — 변경 없음 (PR #139에서 await 보장 완료)
- 웹 zero-downtime 정책 — 그대로 유지
