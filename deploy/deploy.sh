#!/bin/bash
# myFitness 배포 스크립트
# 사용: ./deploy/deploy.sh [branch|tag]
# 예시: ./deploy/deploy.sh main
#       ./deploy/deploy.sh v0.1.0
#       ./deploy/deploy.sh dev
set -e

TARGET="${1:-main}"
cd /home/nasty68/myFitness

echo "=== 1. Fetch latest ==="
git fetch origin --tags

echo "=== 2. Checkout: $TARGET ==="
git checkout "$TARGET"

# 브랜치인 경우 pull, 태그인 경우 이미 detached HEAD
if git symbolic-ref -q HEAD >/dev/null 2>&1; then
    git pull origin "$TARGET"
fi

echo "=== 3. Install dependencies ==="
npm ci

echo "=== 4. DB Migrate + Generate ==="
npx prisma migrate deploy
npx prisma generate

echo "=== 5. Build ==="
npm run build

echo "=== 6-a. PM2 MCP (먼저 재시작 — 웹/봇이 HTTP 로 붙기 전 준비) ==="
# #180: MCP 서버를 stdio subprocess → 상시 상주 HTTP 서버로 승격.
# 초기 배포 (pm2 앱 미등록) 시 startOrReload 가 자동 등록. 이후 배포는 zero-downtime reload.
# ecosystem 옵션 (kill_timeout / MCP_PORT 등) 변경은 reload 로 반영 안 됨 → delete + start 필요.
# 지금은 첫 도입이므로 delete + start 로 확실히 시작 (2번째 배포부터 startOrReload 로 검토 가능).
pm2 delete myfitness-mcp 2>/dev/null || true
pm2 start ecosystem.config.js --only myfitness-mcp

echo "=== 6-b. MCP health check (20s retry, 실패 시 abort) ==="
MCP_PORT="${MCP_PORT:-4301}"
for i in $(seq 1 10); do
  if curl -sf "http://127.0.0.1:${MCP_PORT}/health" >/dev/null 2>&1; then
    echo "[deploy] MCP healthy (attempt $i)"
    break
  fi
  if [[ $i -eq 10 ]]; then
    echo "[deploy] MCP health check 실패 → 롤백 필요. pm2 logs myfitness-mcp 확인" >&2
    exit 1
  fi
  sleep 2
done

echo "=== 6-c. PM2 web / bot ==="
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

echo ""
echo "=== Deploy complete: $TARGET ==="
pm2 status
echo "https://fitness.starryjeju.net"
