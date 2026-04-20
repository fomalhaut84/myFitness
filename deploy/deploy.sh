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
pm2 startOrReload ecosystem.config.js --only myfitness
pm2 startOrReload ecosystem.config.js --only myfitness-bot

echo ""
echo "=== Deploy complete: $TARGET ==="
pm2 status
echo "https://fitness.starryjeju.net"
