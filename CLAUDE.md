# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

개인 피트니스 AI 어드바이저 — Garmin 데이터를 수집·분석하여 맞춤형 운동/건강 조언을 제공하는 웹앱.
개인 서버(Ubuntu)에서 PM2 + Nginx로 운영. 사용자: 본인 1명.

## Tech Stack

- **Framework**: Next.js 14 (App Router, TypeScript)
- **DB**: PostgreSQL + Prisma ORM
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Garmin**: garmin-connect (npm, 비공식 API)
- **AI**: Claude Code CLI (`claude -p`, Max 플랜) + MCP 서버
- **Scheduler**: node-cron (일일 Garmin 싱크)
- **Deploy**: PM2 + Nginx on Ubuntu (port 4200)

## Commands

> 기술 스택 확정 후 업데이트.

```bash
npm run dev              # 개발 서버
npm run build            # 프로덕션 빌드
npm run start            # 프로덕션 실행
npm run lint             # ESLint
```

검증 순서 (PR 전 필수):
```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

## Project Structure

```
src/app/              → 페이지 + API routes (App Router)
src/components/       → React 컴포넌트 (layout/, dashboard/, activity/, sleep/, heart/, ai/, ui/)
src/lib/              → 비즈니스 로직 (prisma.ts, garmin/, ai/, cron.ts, format.ts)
src/mcp/              → MCP 서버 (AI 어드바이저용, 읽기 전용)
src/types/            → TypeScript 타입
prisma/               → schema.prisma + seed
docs/                 → 설계 문서
docs/designs/         → 승인된 UI/UX 디자인 프로토타입
docs/specs/           → 기능별 상세 스펙
```

## Architecture

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

**핵심 설계 결정:**
- Garmin 비공식 API: 이메일/비밀번호 인증, 2FA 없음. 세션 만료 시 자동 재인증.
- 싱크 전략: 초기 365일 히스토리 로드, 이후 매일 06:00 KST cron 증분 싱크.
- AI 어드바이저: MCP 서버로 DB 데이터 노출 → Claude CLI가 조회 후 맞춤 조언.
- 인증: Nginx basic auth (단일 사용자).
- 러닝 중심 분석: 페이스, HR존, VO2max, 트레이닝 로드 우선.

## Key Domain Rules

- **러닝 중심**: 활동 분석, AI 조언 모두 러닝 데이터 우선 처리.
- **수치 단위**: 거리 km(소수점 2자리), 페이스 min:sec/km, 심박수 bpm(정수), 칼로리 kcal(정수), 체중 kg(소수점 1자리), 수면 시간:분.
- **Garmin 데이터 보존**: 모든 모델에 `rawData Json?` 필드로 원본 응답 보존.
- **싱크 중복 방지**: Activity는 `garminId @unique`, 일별 데이터는 `date @unique` + upsert.

## Coding Conventions

- 한국어 UI, 코드/변수명은 영어.
- 컴포넌트: 함수형 + hooks. default export.
- API routes: `src/app/api/` 아래 route.ts. try-catch + `{ error: string }` 에러 응답.
- DB 접근: 반드시 `@/lib/prisma` singleton. raw query 금지.
- 날짜는 ISO 8601. 수치는 단위와 함께 표시.
- 다크 테마 기본, 모바일 반응형.
- 커밋: conventional commits (`feat(scope): desc (#issue)`)

## Workflow

모든 기능 개발은 10단계 워크플로우를 따른다. **상세: `.claude/rules/workflow.md`**

```
기획 → 문서화(docs/specs/) → GitHub 이슈 → UI/UX 디자인(frontend-design 스킬)
→ 구현 계획 → 개발 → 테스트 → 코드 리뷰(P1/P2=0까지) → PR → [사용자 머지] → 이슈 종료
```

- 브랜치: `main`(실서비스) → `dev`(개발) → `feat/<issue>-<n>` / `fix/<issue>-<n>` (dev에서 생성, dev로 PR)
- hotfix: main에서 생성 → main + dev 양쪽 머지
- 릴리즈: dev → main 머지 후 `v{major}.{minor}.{patch}` 태그
- PR 머지는 사용자가 직접 수행. `gh` CLI로 이슈/PR 생성.

## Detailed Rules (`.claude/rules/`)

- `api-routes.md` — API route handler 패턴, 에러 응답
- `components.md` — 컴포넌트 규칙, 수치 포맷
- `workflow.md` — 10단계 워크플로우 전문, 브랜치/릴리즈/코드리뷰 절차

## 하네스: myFitness Dev/Ops

**목표:** 개발 (feat/fix → PR) / 리뷰 사이클 (Codex bot + pr-review-toolkit) / 릴리즈 (dev → main → tag → Release) / 운영 진단 (pm2/mcp/psql) / Prisma migration 을 5개 전문 에이전트로 자동화.

**트리거:** myFitness 개발/운영 관련 작업 요청 시 `myfitness-orchestrator` 스킬을 사용하라.
- Codex 리뷰 URL 붙여넣기 → `codex-review-loop`
- "새 기능" / "버그 fix" → `branch-workflow`
- "머지완료" / "릴리즈해줘" → `release-flow` (+ `orphan-check`)
- Prisma migrate 에러 / schema 변경 → `prisma-drift-fix`
- "배포 실패" / "리포트 안 옴" / 로그 요청 → `ops-diagnose`
- "새 세션" / "다음 작업" / "어디까지 했지" → `session-primer`
- "여기서 마무리" / "오늘 정리" / "다음 세션에 이어서" → `session-handoff`

단순 질문/설명은 직접 응답 가능.

**세션 관리 원칙 (2026-08-27 추가):**
- Phase 단위 세션이 기본. 릴리즈 완료가 자연 종료 신호.
- **예외 (중요): 자연 이어지는 흐름은 인위적 분할 금지**. 실사용 이슈 → hotfix → 후속 이슈가 자연 이어지면 세션 그대로 유지. 세션 관리는 도구지 룰이 아님.
- 신규 세션 진입 시 `session-primer` 로 진행 상태 재로드 (`docs/specs/M<N>-followup.md` 참조).
- 세션 종료 전 `session-handoff` 로 백로그/memory 갱신 — **단, 사용자 명시 요청 시에만**. 스킬이 자동으로 종료 유도 X.
- Hotfix 는 항상 새 세션 (이전 릴리즈 컨텍스트 오염이 실질 위험).
- **Codex 리뷰가 10라운드+ 로 세부만 파고들면 판단** — 문서 개선이 실코드 이득에 명확히 기여 안 하면 그 시점에 종료.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-14 | 초기 구성 (5 agents + 7 skills) | 전체 | 이번 세션 관찰된 반복 패턴 (Codex 사이클 30+회, orphan 3회, 릴리즈 흐름) 자동화 |
| 2026-08-27 | session-primer + session-handoff 추가 | 세션 관리 | 세션 길어질수록 컨텍스트 오염/압축 손실. 릴리즈/Phase 단위 인계 자동화 |

## 의존성 취약점 대응

**자체 `Security Audit` 워크플로우로 일원화한다. Dependabot 자동 보안 PR 은 사용하지 않는다** (#359, 2026-09-03 비활성화).

| 수단 | 상태 |
|---|---|
| Dependabot 취약점 **알림** | 유지 |
| Dependabot 자동 보안 **PR** | **비활성화** |
| `.github/workflows/security-audit.yml` | 주간(월 03:00 UTC) + `package.json`/`package-lock.json` push 마다 실행 |

### 왜 Dependabot 자동 PR 을 끄는가

1. **브랜치 정책 위반** — 보안 업데이트는 항상 default branch(`main`)를 타겟한다. `target-branch: dev` 는 [버전 업데이트에만 적용](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)되므로 설정으로 막을 수 없다. hotfix 외 main 직접 변경은 금지.
2. **커버리지가 좁다** — PR #353 은 4건만 잡았고 `nanoid`·`deepmerge-ts`(high, `@prisma/config`→`prisma` 체인 3건 견인)를 놓쳤다. 그것만 머지했으면 `npm audit` 은 계속 실패했을 것이다. 자체 대응(PR #355)은 6건 전부 처리해 0건을 달성했다.

### 대응 절차

1. `Security Audit` 실패 또는 이슈 자동 생성 → 취약점 확인
2. `npm audit --json` 으로 취약 범위·유입 경로·패치 버전 파악
3. **`package.json` `overrides` 버전 상향**으로 해결 — 직접 의존성 major 업그레이드는 별도 판단
   - 같은 major 안의 패치본을 우선 (예: `fast-uri` 는 ajv 가 `^3.0.1` 을 요구하므로 4.x 가 아닌 3.1.7)
4. 런타임에 닿는 bump 는 실동작 검증 (`prisma generate` / `migrate status`, MCP `tools/list` 등)
5. `gh workflow run "Security Audit" --ref <branch>` 로 머지 전 검증
6. `dev` 로 PR

Dependabot 보안 PR 이 과거 이력으로 남아 있으면 close 한다. 자체 audit 이 상위집합이다.

## Reference Docs

- `docs/architecture.md` — 기술 스택, 아키텍처, Garmin 싱크 전략, 환경변수
- `docs/roadmap.md` — Phase 1~6 구현 계획

## Phase Status

현재 Phase 1 (Foundation) 시작 전. 전체 로드맵: `docs/roadmap.md`
