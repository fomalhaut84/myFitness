#!/bin/bash
# myFitness 배포 스크립트
# 사용: ./deploy/deploy.sh [branch|tag]
# 예시: ./deploy/deploy.sh main
#       ./deploy/deploy.sh v0.1.0
#       ./deploy/deploy.sh dev
set -e

TARGET="${1:-main}"
cd /home/nasty68/myFitness

# 우선순위: shell override > .env > default 4301.
# server.ts / claude-advisor.ts / ecosystem.config.js 모두 동일 우선순위를 지켜
# 서버가 listen 하는 포트와 client/health check 가 정확히 일치.
if [[ -z "${MCP_PORT:-}" && -f .env ]]; then
    # bash grep 은 dotenv 호환 형태 (export prefix / '=' 주변 공백 / inline comment /
    # 따옴표) 를 못 다룸. src/mcp/server.ts 가 사용하는 것과 동일한 dotenv 파서를
    # node 로 재사용. dotenv.parse(buf) 로 process.env 오염 없이 KV 만 추출
    # (dotenv.config() 은 v17+ 에서 stdout 안내 문자를 인쇄 → 파싱 값에 섞임).
    ENV_MCP_PORT=$(node -e "const fs=require('fs');const p=require('dotenv').parse(fs.readFileSync('.env'));process.stdout.write(p.MCP_PORT ?? '')" 2>/dev/null || echo "")
    MCP_PORT="${ENV_MCP_PORT:-}"
fi
MCP_PORT="${MCP_PORT:-4301}"

# Pre-flight 임시 포트 — 4200 (웹) / MCP_PORT (mcp 실서비스) 와 충돌 회피.
PREFLIGHT_PORT="${MCP_PREFLIGHT_PORT:-4399}"

echo "=== 1. Fetch latest ==="
git fetch origin --tags

echo "=== 2. Checkout: $TARGET ==="
# -f: dev 배포 등에서 worktree 가 dirty 여도 target 강제 반영.
git checkout -f "$TARGET"

# 브랜치인 경우 pull, 태그인 경우 이미 detached HEAD
if git symbolic-ref -q HEAD >/dev/null 2>&1; then
    git pull origin "$TARGET"
fi

echo "=== 3. Install dependencies ==="
npm ci

echo "=== 4. DB Migrate + Generate ==="
npx prisma migrate deploy
npx prisma generate

echo "=== 5. Build (staged out-of-place for MCP) ==="
# next + build:mcp:staged (dist/mcp/server.staged.cjs) + build:bot.
# build:mcp:activate 는 pre-flight 통과 후 별도 실행 → dist/mcp/server.cjs 는
# 실행 중 subprocess spawn (bot 이 stdio 모드 fallback) 이 old 를 참조할 수 있도록 유지.
npm run build:staged

echo "=== 6-a. Pre-flight: staged 검증 (임시 포트 ${PREFLIGHT_PORT}) ==="
# 목적: pm2 restart 로 mcp 앱을 교체하기 전에 새 dist/mcp/server.staged.cjs 가
# 실제로 부팅 + health 응답하는지 확인. 크래시 (env / 스키마 오류 등) 를 사전에 잡아
# 실서비스 인스턴스 유지한 채 abort → 무중단.

# 이전 배포가 interrupt 되어 pre-flight 포트에 좀비가 남아있을 수 있음.
# 정리하지 않으면 좀비 응답이 pre-flight 성공으로 오인 (false-positive).
if curl -sS -f -o /dev/null "http://127.0.0.1:${PREFLIGHT_PORT}/health" 2>/dev/null; then
    echo "WARN: pre-flight port ${PREFLIGHT_PORT} 이 이미 응답 중 (좀비 프로세스 의심)"
    if command -v lsof >/dev/null 2>&1; then
        STALE_PIDS=$(lsof -ti "tcp:${PREFLIGHT_PORT}" 2>/dev/null || true)
        if [ -n "$STALE_PIDS" ]; then
            echo "stopping stale process(es): $STALE_PIDS"
            echo "$STALE_PIDS" | xargs -r kill -TERM 2>/dev/null || true
            sleep 2
            echo "$STALE_PIDS" | xargs -r kill -KILL 2>/dev/null || true
            sleep 1
        fi
    else
        echo "WARN: lsof 없음 → 좀비 자동 정리 불가"
    fi
    # 재검증: 여전히 응답하면 pre-flight 결과 신뢰 불가 → abort.
    if curl -sS -f -o /dev/null "http://127.0.0.1:${PREFLIGHT_PORT}/health" 2>/dev/null; then
        echo "ERROR: 좀비 정리 실패 — port ${PREFLIGHT_PORT} 여전히 응답 중"
        echo "  운영자 수동: lsof -i tcp:${PREFLIGHT_PORT} → 해당 프로세스 종료"
        rm -f dist/mcp/server.staged.cjs
        echo "removed staged build. dist/mcp/server.cjs 는 old 유지 → 서비스 무중단"
        exit 1
    fi
    echo "좀비 정리 완료 → pre-flight 진행"
fi

# Staged 실행. dist/mcp/server.cjs 는 old (또는 부재) 그대로.
PREFLIGHT_LOG=$(mktemp -t mcp-preflight-XXXXXX.log)
MCP_TRANSPORT=http MCP_PORT="$PREFLIGHT_PORT" node dist/mcp/server.staged.cjs > "$PREFLIGHT_LOG" 2>&1 &
PREFLIGHT_PID=$!

PREFLIGHT_OK=0
for i in $(seq 1 20); do
    # curl 성공 + PID liveness 병행 검증 (좀비 정리 이후 재바인딩 실패 등 방어).
    if curl -sS -f -o /dev/null "http://127.0.0.1:${PREFLIGHT_PORT}/health" \
       && kill -0 "$PREFLIGHT_PID" 2>/dev/null; then
        PREFLIGHT_OK=1
        echo "pre-flight OK (after ${i}s, PID $PREFLIGHT_PID alive)"
        break
    fi
    # 조기 종료 감지
    if ! kill -0 "$PREFLIGHT_PID" 2>/dev/null; then
        echo "ERROR: pre-flight 프로세스 조기 종료. 로그:"
        cat "$PREFLIGHT_LOG" || true
        rm -f "$PREFLIGHT_LOG" dist/mcp/server.staged.cjs
        echo "removed staged build. dist/mcp/server.cjs 는 old 유지 → 서비스 무중단"
        exit 1
    fi
    sleep 1
done

# Pre-flight 프로세스 정리 (성공 여부 무관)
kill -TERM "$PREFLIGHT_PID" 2>/dev/null || true
wait "$PREFLIGHT_PID" 2>/dev/null || true

if [ "$PREFLIGHT_OK" != "1" ]; then
    echo "ERROR: pre-flight health 실패. 로그:"
    cat "$PREFLIGHT_LOG" || true
    rm -f "$PREFLIGHT_LOG" dist/mcp/server.staged.cjs
    echo "removed staged build. dist/mcp/server.cjs 는 old 유지 → 서비스 무중단"
    exit 1
fi
rm -f "$PREFLIGHT_LOG"

echo "=== 6-b. Activate: staged → server.cjs (atomic mv) ==="
# Pre-flight 통과 → 이 시점부터 subprocess spawn (bot stdio fallback) 이 새 dist 로드.
npm run build:mcp:activate

echo "=== 7-a. PM2 MCP restart + health 재확인 (실서비스 포트 ${MCP_PORT}) ==="
# startOrRestart (hard restart) 이유:
# 고정 포트를 잡는 fork 단일 프로세스라 old 살아있는 상태에서 새 인스턴스가 뜨면
# EADDRINUSE. reload 는 replacement 를 먼저 스폰 → 이 상황 유발. hard restart 는
# stop old → spawn new 순서라 안전. 앱이 없으면 자동 start.
pm2 startOrRestart ecosystem.config.js --only myfitness-mcp

MCP_HEALTHY=0
for i in $(seq 1 20); do
    if curl -sS -f -o /dev/null "http://127.0.0.1:${MCP_PORT}/health"; then
        MCP_HEALTHY=1
        echo "MCP server healthy (after ${i}s)"
        break
    fi
    sleep 1
done

if [ "$MCP_HEALTHY" != "1" ]; then
    echo "ERROR: MCP restart 후 health 실패 (pre-flight 는 통과, 실서비스 포트 문제 가능)"
    pm2 logs myfitness-mcp --lines 50 --nostream || true
    # crash-loop 방지: pm2 autorestart 반복 방지. 운영자 수동 확인 유도.
    echo "myfitness-mcp 를 stop 처리하여 crash-loop 회피"
    pm2 stop myfitness-mcp 2>&1 | tail -3 || true
    echo "웹/봇 재시작 X. 배포 abort"
    exit 1
fi

echo "=== 7-b. PM2 web / bot ==="
# web: stateless → graceful reload (zero-downtime) + --update-env 로 env 변수 갱신
pm2 startOrReload ecosystem.config.js --only myfitness --update-env
# bot: 두 가지 동시 보장 필요:
# (1) 텔레그램 long polling 은 토큰당 1 인스턴스만 허용 → reload/restart 시 두 봇 겹치면 409.
# (2) ecosystem 옵션(kill_timeout/exp_backoff_restart_delay 등) 변경은 reload/restart로 적용 안 됨,
#     PM2 process를 완전 삭제 후 재등록해야 반영됨.
# → delete + start 가 두 요건 모두 충족. 봇은 stateless라 1-2초 다운타임 무관.
# docs/specs/140-bot-409-conflict-fix.md 참조.
pm2 delete myfitness-bot 2>/dev/null || true
pm2 start ecosystem.config.js --only myfitness-bot

echo "=== 8. pm2 save (host reboot 시 resurrect 대비) ==="
# 첫 배포에서 새 앱 (myfitness-mcp) 추가 후 save 를 안 하면 host reboot 시
# resurrect 가 이전 저장된 목록만 복원 → myfitness-mcp 실종. 매 배포마다 save.
# 실패해도 서비스는 정상 (config 정합 + 프로세스 running 완료). abort 로 운영자 확인 유도.
pm2 save --force

echo ""
echo "=== Deploy complete: $TARGET ==="
pm2 status
echo "https://fitness.starryjeju.net"
