# 아키텍처

## Tech Stack

| Layer | 선택 | 비고 |
|---|---|---|
| Framework | Next.js 14 (App Router) | myFinance와 동일 |
| Language | TypeScript | |
| DB | PostgreSQL + Prisma ORM | DB명: `myfitness` |
| Styling | Tailwind CSS | 다크 테마 기본 |
| Charts | Recharts | |
| Garmin | `garmin-connect` (npm) | 비공식 API |
| AI | Claude Code CLI (`claude -p`) | MCP 서버 연동 |
| Scheduler | `node-cron` | 일일 싱크 |
| Auth | Nginx basic auth | 단일 사용자 |
| Deploy | PM2 + Nginx, port 4200 | Ubuntu |
| 추가 | `date-fns`, `marked`, `next-themes` | |

## 아키텍처 다이어그램

```
Frontend (Next.js SSR/CSR)
    ↕ API Routes
Backend (Prisma + Business Logic)
    ↕
PostgreSQL  ←  node-cron (Garmin 일일 싱크)
    ↕               ↓
Claude Code CLI   garmin-connect (비공식 API)
    ↕                   ↓
MCP Server        Garmin Connect
(읽기 전용)
```

## Garmin 싱크 전략

- **인증**: `.env`에 이메일/비밀번호. 세션 만료 시 자동 재인증. 2FA 없음.
- **초기 로드**: 365일 히스토리. 순서: DailySummary → Activity → Sleep → HeartRate → BodyComposition.
- **API 호출 간 2초 딜레이** (rate limit 방지).
- **일일 싱크**: 매일 06:00 KST cron. `lastSyncDate` ~ 어제까지 upsert.
- **수동 싱크**: `POST /api/sync` (기본 최근 3일, 날짜 범위 지정 가능).
- **에러 처리**: 429 시 60초 대기 후 재시도. 데이터 타입별 독립 싱크.

## 프로젝트 구조

```
src/
├── app/
│   ├── page.tsx                 # 대시보드 홈
│   ├── activities/              # 러닝/운동 목록 + 상세
│   ├── sleep/                   # 수면 분석
│   ├── heart/                   # 심박/HRV
│   ├── body/                    # 체성분
│   ├── lifestyle/               # 생활 패턴
│   ├── ai/                      # AI 채팅
│   └── api/                     # API routes
├── components/
│   ├── layout/                  # 사이드바, 헤더
│   ├── dashboard/               # 요약 카드, 미니 차트
│   ├── activity/                # 활동 관련
│   ├── sleep/                   # 수면 관련
│   ├── heart/                   # 심박 관련
│   ├── ai/                      # 채팅 UI
│   └── ui/                      # 공용 컴포넌트
├── lib/
│   ├── prisma.ts
│   ├── garmin/                  # 클라이언트, 싱크, 파서
│   ├── ai/                      # Claude 래퍼, 시스템 프롬프트, MCP 설정
│   ├── cron.ts
│   └── format.ts                # 단위 포맷 (km, bpm, kg 등)
├── mcp/server.ts                # MCP 서버
└── types/
prisma/
├── schema.prisma
└── seed.ts
docs/
├── specs/                       # 기능별 상세 스펙
├── designs/                     # 승인된 UI/UX 디자인
├── roadmap.md
└── architecture.md
```

## 환경 변수

```
DATABASE_URL=postgresql://user:pass@localhost:5432/myfitness
GARMIN_EMAIL=xxx@gmail.com
GARMIN_PASSWORD=xxx
PORT=4200
NODE_ENV=production
BASIC_AUTH_USER=xxx
BASIC_AUTH_PASS=xxx
```
