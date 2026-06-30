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

echo "=== 6. PM2 Restart ==="
# web: --update-env 로 env 변수 갱신하며 zero-downtime reload
pm2 startOrReload ecosystem.config.js --only myfitness --update-env
# bot: ecosystem 옵션(min_uptime/max_restarts/instances 등) 변경이 reload로 적용되지 않으므로
#      delete + start로 옵션 100% 반영. 봇은 stateless라 1-2초 다운타임 무관.
pm2 delete myfitness-bot 2>/dev/null || true
pm2 start ecosystem.config.js --only myfitness-bot

echo ""
echo "=== Deploy complete: $TARGET ==="
pm2 status
echo "https://fitness.starryjeju.net"
