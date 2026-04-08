# [M2] 텔레그램 봇

## 목적

myFinance에서 검증된 텔레그램 봇 아키텍처를 myFitness에 적용.
피트니스 데이터 조회, AI 어드바이저 질문, 식단 기록, 모닝/이브닝 리포트 자동 전달.

## 요구사항

### 커맨드
- [ ] `/start`, `/help` — 사용 안내
- [ ] `/today` — 오늘 요약 (걸음, 심박, 바디배터리, 수면점수)
- [ ] `/run` — 최근 러닝 요약 (거리, 페이스, HR)
- [ ] `/sleep` — 어젯밤 수면 요약 (점수, 단계, SpO2, HRV)
- [ ] `/weight` — 최근 체중 + 추세
- [ ] `/sync` — 수동 Garmin 싱크 트리거
- [ ] `/report` — 최근 모닝/이브닝 리포트 표시
- [ ] `/ai [질문]` — AI 어드바이저 질문
- [ ] `/reset` — AI 세션 초기화

### 자연어 입력
- [ ] 식단 입력: `점심 김치찌개 밥` → FoodLog 기록
- [ ] 질문 감지: 자유 텍스트 → AI 어드바이저 전달

### 자동 알림 (Cron → 텔레그램)
- [ ] 모닝 리포트 (08:00 KST): 수면 분석 + 회복 상태 + 오늘 추천
- [ ] 이브닝 리포트 (23:00 KST): 하루 정리 + 회복 필요성 + 내일 계획
- [ ] 주간 리포트 (월 07:00 KST): 주간 종합 분석

## 기술 설계

### 아키텍처 (myFinance 패턴)
- grammY 라이브러리 + long polling
- 별도 PM2 프로세스 (`myfitness-bot`)
- esbuild로 standalone CJS 번들 (`dist/bot/standalone.cjs`)
- 미들웨어 기반 인증 (TELEGRAM_ALLOWED_CHAT_IDS 화이트리스트)

### 프로젝트 구조
```
src/bot/
├── index.ts              # 봇 생성 + 커맨드 등록
├── standalone.ts         # PM2 엔트리포인트
├── commands/
│   ├── start.ts          # /start, /help
│   ├── today.ts          # /today
│   ├── run.ts            # /run
│   ├── sleep.ts          # /sleep
│   ├── weight.ts         # /weight
│   ├── sync.ts           # /sync
│   ├── report.ts         # /report
│   ├── ai.ts             # /ai + 자연어 fallback
│   └── food.ts           # 식단 입력 감지
├── notifications/
│   ├── scheduler.ts      # Cron 알림 스케줄러
│   ├── morning.ts        # 모닝 리포트 생성 + 전송
│   └── evening.ts        # 이브닝 리포트 생성 + 전송
├── middleware/
│   └── auth.ts           # 채팅 ID 화이트리스트
└── utils/
    ├── formatter.ts      # 수치 포맷 (km, bpm, 페이스)
    ├── telegram.ts       # HTML 전송 + 에러 fallback
    └── markdown.ts       # 마크다운 → 텔레그램 HTML
```

### 배포
- PM2: `myfitness-bot` 프로세스 (512M, autorestart)
- 빌드: `npm run build:bot` → esbuild
- 환경변수: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`

### 의존성
- `grammy` — 텔레그램 봇 API
- 기존: `node-cron`, `@prisma/client`, AI 어드바이저

## 테스트 계획
- [ ] `npm run build:bot` 성공
- [ ] 봇 시작 → `/start` 응답
- [ ] `/today`, `/run`, `/sleep` → 데이터 응답
- [ ] `/ai 질문` → AI 응답
- [ ] 모닝/이브닝 리포트 cron → 텔레그램 전송
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run build` 통과
