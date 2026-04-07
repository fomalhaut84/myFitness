# [Phase 1] 프로젝트 초기화 + PM2 배포 설정

## 목적

Next.js 14 + TypeScript + Tailwind + Prisma 기반의 프로젝트 스캐폴드를 만들고,
PM2 + Nginx 배포 설정까지 완료하여 서버에서 빈 페이지가 뜨는 상태까지 구성한다.

## 요구사항

- [x] Next.js 14 App Router + TypeScript 프로젝트 생성
- [ ] Tailwind CSS + 다크 테마 기본 (CSS 변수 기반)
- [ ] Prisma ORM + PostgreSQL 연결 (`myfitness` DB)
- [ ] ESLint + TypeScript strict 설정
- [ ] PM2 ecosystem.config.js (port 4200, `myfitness` 프로세스)
- [ ] Nginx reverse proxy 설정 (fitness.starryjeju.net → localhost:4200)
- [ ] 배포 스크립트 (deploy/deploy.sh)
- [ ] .env.example 작성
- [ ] 빈 랜딩 페이지 ("myFitness" 텍스트만 표시, 서버 정상 동작 확인용)

## 기술 설계

### 프로젝트 생성

```bash
npx create-next-app@14 . --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

> 이미 README.md, .gitignore 등이 있으므로 기존 파일과 충돌 주의.
> `@/*` alias는 tsconfig에서 수동 설정.

### 주요 설정 파일 (myFinance 패턴 복제)

- `tsconfig.json`: strict, `@/*` → `./src/*` alias
- `tailwind.config.ts`: darkMode 'class', CSS 변수 기반 컬러 시스템
- `.eslintrc.json`: next/core-web-vitals + next/typescript
- `postcss.config.mjs`: tailwindcss 플러그인
- `next.config.mjs`: instrumentationHook 활성화 (Phase 3 cron용)
- `prisma.config.ts`: dotenv + classic 엔진

### CSS 변수 (다크 테마)

myFinance 디자인 시스템 기반, 피트니스 도메인에 맞게 조정:
- bg, bg-raised, card, surface 계열 (다크 배경)
- dim, sub, muted, bright (텍스트 계층)
- 포인트 컬러: 피트니스/러닝 느낌의 컬러 (추후 디자인 시 확정)

### PM2 설정

```js
{
  name: 'myfitness',
  script: 'node_modules/.bin/next',
  args: 'start -p 4200',
  cwd: '/home/nasty68/myFitness',
  env: { NODE_ENV: 'production', PORT: 4200 },
  instances: 1,
  autorestart: true,
  max_memory_restart: '1024M',
}
```

### Nginx 설정

`deploy/nginx/myfitness.conf`:
- server_name: fitness.starryjeju.net
- proxy_pass: localhost:4200
- gzip, 정적 파일 캐시, WebSocket 지원
- certbot으로 SSL 추가 예정

### 배포 스크립트

`deploy/deploy.sh`: myFinance와 동일 패턴.
git fetch → checkout → npm ci → prisma migrate deploy → npm run build → pm2 restart.

### 환경 변수

```
DATABASE_URL=postgresql://user:pass@localhost:5432/myfitness
BASE_URL=http://localhost:4200
PORT=4200
GARMIN_EMAIL=
GARMIN_PASSWORD=
```

## 테스트 계획

- [ ] `npm run dev` → localhost:3000 접속 → "myFitness" 텍스트 표시
- [ ] `npm run lint` 통과
- [ ] `npx tsc --noEmit` 통과
- [ ] `npm run build` 성공
- [ ] Prisma: `npx prisma db push` → DB 연결 확인 (스키마는 #2에서)

## 제외 사항

- DB 스키마/모델 정의 (이슈 #2)
- Garmin 연동 (이슈 #3)
- 실제 페이지/컴포넌트 구현 (Phase 2)
