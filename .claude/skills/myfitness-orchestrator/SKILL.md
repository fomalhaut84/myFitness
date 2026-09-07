---
name: myfitness-orchestrator
description: myFitness 프로젝트 작업 라우팅 오케스트레이터. 사용자 요청을 분석해 적절한 전문 에이전트(codex-liaison / workflow-conductor / release-manager / db-migrator / ops-analyst) 로 위임한다. 트리거 — Codex 리뷰 URL 붙여넣기, "머지완료", "리뷰 확인해줘", "새 기능", "버그 fix", "릴리즈해줘", "배포 실패", "리포트 안 옴", "Prisma migrate 실패", 스키마 변경 요청, 로그 분석 요청, 오탈자 감지 등 myFitness 관련 개발/운영 요청. 새 세션 시작 시 이 프로젝트 컨텍스트 진입 신호로도 사용.
---

# myFitness Orchestrator

myFitness 프로젝트 (Next.js + Prisma + PM2 + MCP + Telegram bot) 개발/운영 워크플로우를 5개 전문 에이전트로 라우팅한다.

## Phase 1: 컨텍스트 확인

작업 시작 전 확인:

1. **현재 브랜치**: `git branch --show-current`
2. **미커밋 변경**: `git status --short` — 있으면 어느 흐름 중인지 파악
3. **최근 이슈/PR**: `gh pr list --state open --limit 3` — 이어서 할 작업인지
4. **_workspace/**: 이 하네스는 파일 기반 산출물 없음 — 직접 파일 편집

이전 컨텍스트가 있으면 이어서, 없으면 새 요청으로 진입.

## Phase 2: 요청 분석 → 에이전트 선택

사용자 발화에서 아래 신호를 감지해 하나 이상 에이전트에 위임한다.

### codex-liaison 트리거

- `pullrequestreview-<id>` URL 붙여넣기
- "리뷰 확인해줘" / "이 리뷰 반영해줘"
- `@codex review` 재요청 판단
- Squash merge 후 orphan 커밋 회수

**스킬**: `codex-review-loop`, `orphan-check`

### workflow-conductor 트리거

- "새 기능" / "이 기능 추가해줘" / "bug fix 해줘"
- 이슈 번호 언급하며 착수 요청
- 스펙 작성 필요
- 3-check + 사전 리뷰 + PR 오픈

**스킬**: `branch-workflow`, `orphan-check`

### release-manager 트리거

- "머지완료" (PR 머지 알림)
- "릴리즈해줘" / "v<X.Y.Z> 태그"
- dev → main PR 필요 판단

**스킬**: `release-flow`

### db-migrator 트리거

- `prisma migrate dev` 실패 (drift 감지)
- schema.prisma 편집 필요
- Migration 파일 수동 작성 필요

**스킬**: `prisma-drift-fix`

### ops-analyst 트리거

- "배포 실패" / "리포트 안 옴" / "값이 이상해"
- PM2 / MCP / psql 로그 조회 필요
- 배포 후 검증

**스킬**: `ops-diagnose`

### 여러 에이전트 필요한 복합 요청

순차 진행:
- "새 기능 X" → workflow-conductor → (schema 변경 시) db-migrator → codex-liaison (리뷰 대응) → release-manager (릴리즈)

## Phase 3: 실행 모드

**서브 에이전트 모드 (기본)**. 오케스트레이터 (Claude 메인) 가 아래 명령으로 위임:

```
Agent(subagent_type: "codex-liaison", model: "opus",
      prompt: "<URL 또는 요청>")
```

or `.claude/agents/*.md` 정의된 에이전트를 참조해 오케스트레이터가 직접 실행. 서브 에이전트로 위임하지 않고 오케스트레이터가 스킬을 로드해 진행해도 무방 (오버헤드 회피).

**서브 에이전트 위임 판단**:
- 대규모 조사 (여러 파일 grep + 분석) → 서브 에이전트로 컨텍스트 분리
- 짧은 작업 (커밋 하나 반영) → 오케스트레이터 직접 진행

## Phase 4: 산출물

이 하네스는 파일 기반 산출물이 없다. 각 에이전트/스킬이 다음을 직접 수정:

- `src/**` (구현)
- `prisma/**` (스키마/migration)
- `docs/specs/**` (스펙 문서)
- `.github/**` (workflow)
- Git commit / GitHub issue / PR / Release

## Phase 5: 사용자 승인 규칙

다음은 사용자 명시 승인 필요 (자동 진행 금지):

- **DB migration apply** (프로덕션 영향): 로컬 apply 는 OK. 프로덕션은 deploy.sh 가 자동.
- **dev → main PR 머지**: `release-manager` 는 PR 생성만. 머지는 사용자.
- **`git push --force`**: 절대 금지 (workflow.md).
- **`prisma migrate reset`**: 절대 금지 (data loss).

## 후속 작업 지원

이미 진행중인 흐름 재요청 시:
- 브랜치 이어서 진행 (`git branch` 확인)
- 이슈 재open 없이 후속 커밋
- 릴리즈 태그 존재 시 재확인 요청 (자동 bump X)

## 참고 자원

- `.claude/rules/workflow.md` — 10단계 워크플로우 상세
- `.claude/rules/api-routes.md` — API 규칙
- `.claude/rules/components.md` — 컴포넌트 규칙
- `CLAUDE.md` — 프로젝트 개요
- Memory (`~/.claude/projects/-Users-sagan-workspace-myFitness/memory/`)
