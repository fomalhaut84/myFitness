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

## OMRON 싱크 (#514)

- **대상**: OMRON Connect Cloud (비공식 · 아시아 리전 v1) 의 혈압계 · 체중계 측정. 스펙 `docs/specs/514-omron-direct-sync.md`.
- **코드**: `src/lib/omron/` (config · client · parse · aggregate · write-policy · sync). 프로토콜은 자체 PoC 실측 기준 — 참고한 omramin (GPL-2.0) 코드는 사용하지 않는다.
- **실행**: `syncAll` 의 dataType `omron_body_composition` · `omron_blood_pressure` (Garmin 체중 · 혈압 뒤). cron · `/api/sync` · 봇 · 리포트 사전 싱크 공통. env 5개가 없으면 건너뛴다.
- **인증**: refresh token 을 `.omron-tokens/` (0600) 에 보관 · 재사용 (회전 안 함). 실패 시 비밀번호 로그인. 인증 실패는 관리자 알림.
- **저장**: KST 날짜별 1행. 혈압은 일 집계 + 개별 측정 (`measurements`), category 는 AHA 2017 · 그날 최고 단계. 체중은 그날 **가장 이른 측정**이 대표, 전체 측정은 rawData.
- **중복**: OMRON 우선 — Garmin 행은 OMRON 으로 교체 (원본은 `rawData.replacedGarmin`), `manual` 은 보호. Garmin 싱크는 `manual` · `omron` 행을 덮지 않는다.

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
OMRON_EMAIL=xxx            # #514 · 5개 모두 있어야 OMRON 싱크 활성
OMRON_PASSWORD=xxx
OMRON_APP_ID=xxx           # OMRON 앱 값 — 커밋 금지
OMRON_APP_KEY=xxx
OMRON_API_BASE=https://…   # 아시아 리전 v1
PORT=4200
NODE_ENV=production
BASIC_AUTH_USER=xxx
BASIC_AUTH_PASS=xxx
```
