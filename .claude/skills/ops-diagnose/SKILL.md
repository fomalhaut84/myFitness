---
name: ops-diagnose
description: myFitness 배포/운영 이슈 진단을 위한 명령 생성. 사용자가 실행할 pm2 logs / MCP logs / psql / gh run view 명령을 상황별 grep 패턴과 함께 제공. "배포 실패", "리포트 안 옴", "MCP 오류", "값이 이상해", "cron 안 돌아" 등 이슈 발생 시 사용. UTC↔KST 변환, event flow 재구성 포함.
---

# Ops Diagnose

프로덕션 상태 조사용 명령 생성 (사용자 실행 대행).

## 서버 접근 규칙

**직접 접근 불가**. 사용자에게 명령 제시 → 결과 붙여넣기 받아 분석.

## PM2 앱 구성

- `myfitness` — Next.js 웹 (port 4200)
- `myfitness-bot` — Telegram bot + cron scheduler (standalone.cjs)
- `myfitness-mcp` — MCP HTTP server (port 4301)

## 시나리오별 명령

### 1. 배포 실패

```bash
# 최근 배포 워크플로우
gh run list --workflow=deploy.yml --limit 3

# 상세 로그
gh run view <run_id> --log 2>&1 | grep -E "(===|ERROR|WARN|error|health|MCP|activated)" | head -80

# 서버 pm2 상태
pm2 status
pm2 describe myfitness-mcp | grep -E "(script|version|restart_time|uptime)"

# dist/mcp/server.cjs 갱신 확인
ls -la dist/mcp/server.cjs dist/bot/standalone.cjs
```

**판별**:
- deploy.sh 6-a Pre-flight 로그 없음 → workflow.yml bootstrap 문제 (v2.6.1 이전)
- Pre-flight 성공, 7-a MCP health 실패 → 새 dist 크래시 (`pm2 stop` 되었나 확인)
- Web/bot restart 실패 → env 변경 반영 안 됨 (pm2 delete + start 필요)

### 2. 리포트 실패 (cron)

```bash
# 스케줄러 로그
pm2 logs myfitness-bot --lines 500 --nostream | grep -E "([암어이브닝주간]_report|askAdvisor|attempt|retryWithBoost|preSync)"

# ReportJob DB 이력
psql -d myfitness -c "
SELECT id, status, force, \"startedAt\", \"completedAt\", \"errorMessage\", \"adviceId\"
FROM \"ReportJob\"
WHERE \"reportDate\" = '<YYYY-MM-DD>' AND category = '<category>_report'
ORDER BY \"startedAt\" DESC LIMIT 10;
"

# MCP tool_call 로그 (해당 시각 근처)
grep -E "tool_call" logs/mcp-<YYYY-MM-DD>.log | tail -30
grep -E "T<HH>:0[012]" logs/mcp-<YYYY-MM-DD>.log
```

**판별**:
- `turns=1` + tool_call 로그 없음 → hallucination (Sonnet skip). 재시도 boost 로도 실패 시 prompt 강화 필요.
- errorMessage="tool 호출 부족" → `retryWithBoost=true` 로그 확인 → v2.9.1 배포 여부 재검토.
- status=failed + preSync 로그 없음 → cron 이 실행 시각에 실행 안 됨 (스케줄 or 프로세스 죽음)

### 3. 데이터 불일치 (Garmin vs 리포트)

```bash
# UserProfile 기본 조회 (필드 존재 확인용)
psql -d myfitness -c "
SELECT id, name, height, \"targetWeight\", \"targetAvgPace\", \"targetWeeklyKm\", \"vo2maxRunning\"
FROM \"UserProfile\" LIMIT 1;
"

# 최근 활동 (러닝)
psql -d myfitness -c "
SELECT \"startTime\", \"activityType\", distance, \"avgPace\", \"avgHR\"
FROM \"Activity\"
WHERE \"startTime\" >= NOW() - INTERVAL '3 days'
  AND \"activityType\" LIKE '%running%'
ORDER BY \"startTime\" DESC;
"

# 수면 record
psql -d myfitness -c "
SELECT date, \"sleepScore\", \"totalSleep\", \"bodyBatteryChange\"
FROM \"SleepRecord\"
ORDER BY date DESC LIMIT 3;
"
```

**판별**:
- DB 값 = Garmin app 값 → sync 정상, hallucination 원인 (모델/prompt).
- DB 값 ≠ Garmin app 값 → sync 지연 (Garmin 재계산 or preSync 시각 이슈).

### 4. MCP 서버 이상

```bash
# HTTP transport
curl -sf http://127.0.0.1:4301/health
pm2 logs myfitness-mcp --lines 100 --nostream | grep -E "(transport_ready|session_|http_request|tool_call|http_server_error)"

# 파일 로그
tail -100 logs/mcp-<YYYY-MM-DD>.log | jq -c 'select(.level == "error" or .level == "fatal")'

# 세션 통계
grep session_initialized logs/mcp-<YYYY-MM-DD>.log | wc -l
grep tool_call logs/mcp-<YYYY-MM-DD>.log | jq -r '.tool' | sort | uniq -c
```

**판별**:
- Health OK, tool_call 없음 → Claude CLI 가 tool 안 부름 (prompt / model 이슈)
- transport_ready 없음 → 서버 부팅 실패 (env / port 충돌)

### 5. 시각 정렬 (UTC↔KST)

- MCP log 시각: **UTC** ISO8601 (예: `2026-07-13T22:00:00Z` = `07:00 KST 14일`)
- pm2 log 시각: **KST** (`2026-07-13 07:00:00`)
- ReportJob DB: **UTC** (Postgres `TIMESTAMP(3)`)

Event flow 재구성 시 반드시 통일 (일반적으로 KST 로).

### 6. 세션 orphan / 데드락

```bash
# 오래된 pending/running ReportJob
psql -d myfitness -c "
SELECT id, category, \"reportDate\", status, \"startedAt\", \"updatedAt\"
FROM \"ReportJob\"
WHERE status IN ('pending', 'running')
  AND \"startedAt\" < NOW() - INTERVAL '10 minutes'
ORDER BY \"startedAt\";
"

# Sweeper 로그
pm2 logs myfitness --lines 200 --nostream | grep -E "(swept|orphaned|sweep)"
```

**판별**: v2.7.0 이후 sweeper 자동 처리. 남아있으면 heartbeat 실패 or DB 문제.

## 결과 분석 원칙

1. **시각 정렬**: 이벤트를 시간 순으로 재구성 (KST 통일)
2. **원인 확정**: "만약 A 이면 원인 X / B 이면 Y" 형식으로 결정 트리 제시
3. **최소 정보 요청**: grep 패턴을 명확히 → 500라인 초과 시 필터 강화
4. **비판별 결과**: "조사 필요" 로 넘기지 않음. 실행 명령 제안까지.

## 참고

- Deploy workflow: `.github/workflows/deploy.yml`
- Deploy 스크립트: `deploy/deploy.sh`
- Ecosystem: `ecosystem.config.js`
- MCP logs: `logs/mcp-YYYY-MM-DD.log` (pino JSON)
