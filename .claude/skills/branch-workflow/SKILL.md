---
name: branch-workflow
description: myFitness workflow.md 10단계 워크플로우를 실행하는 절차. 사용자가 "새 기능", "버그 fix", "이 기능 추가해줘" 요청 시 사용. 이슈 생성 → dev 브랜치 pull → feat/fix 브랜치 → 스펙 문서 → 구현 → 3-check → 사전 리뷰 → PR 오픈까지 전체 자동화.
---

# Branch Workflow

`.claude/rules/workflow.md` 10단계 프로세스를 표준화.

## Step 1: 기획 정리

사용자 요구 → 목적/범위/의존성 3줄 요약. 사용자 승인 후 다음.

## Step 2: 스펙 문서

`docs/specs/<issue>-<feature>.md` 작성. 템플릿:

```markdown
# <제목>

- **작성일**: YYYY-MM-DD
- **타입**: feature | fix | chore
- **이슈**: #<N>

## 1. 배경

## 2. 목표

## 3. 요구사항

- [ ] F1: ...
- [ ] F2: ...

## 4. 기술 설계

## 5. 변경 파일

## 6. 테스트 계획

## 7. 제외 사항
```

이슈 번호가 없으면 Step 3 후 파일 rename.

## Step 3: 이슈 생성

```bash
gh issue create --title "[<type>] <제목>" \
  --body "$(cat docs/specs/<issue>-<feature>.md)" \
  --label "<phase>,<kind>,<priority>"
```

- kind: `feature` / `bug` / `chore`
- priority: `P0` / `P1` / `P2` (없으면 P1)

## Step 4: 브랜치 생성

```bash
git checkout dev && git pull
git checkout -b <feat|fix>/<issue>-<n>
```

- feat: 새 기능
- fix: 버그 (서비스 전이면), hotfix (main 서비스 후 긴급)

## Step 5: 구현

- 커밋 원자화: 하나의 논리적 변경 = 하나의 커밋
- 커밋 메시지: `<type>(<scope>): <desc> (#<issue>)`
- Types: feat / fix / refactor / docs / test / chore / perf / ci
- UI 는 `docs/designs/` 시안 참조

## Step 6: 3-check

```bash
npm run lint && npm run typecheck && npm run build
```

전부 통과. 실패 시 수정 후 재실행. 건너뛰기 금지.

## Step 7: 사전 리뷰

**필수 대상** (workflow.md 8-1):
- `src/**` 로직 (기능 코드)
- `prisma/**` 스키마 변경
- `src/app/api/**` route 신설/수정
- `src/mcp/**` tool 신설/수정

```
Agent(subagent_type: "pr-review-toolkit:code-reviewer",
      model: "opus",
      prompt: "Review branch <feat/N-1> vs dev in /Users/sagan/workspace/myFitness.

## Context
<1~3문장으로 이번 변경 요약>

## Focus files
<주요 파일 목록>

## Focus
- <포커스 항목 1>
- <포커스 항목 2>

## Do NOT flag
- <이미 pre-emptive 커버한 항목>

## Severity
- P0 info | P1 major | P2 critical

## Output
각 이슈: severity + file:line + 설명 + fix. final counts.
없거나 P0 만: 'merge-ready'.")
```

**Self-review 가능 대상**:
- `.github/**` 소규모, `docs/**`, `docs/designs/**` 시안, config 파일 (tailwind 등)

## Step 8: P1/P2 반영

- P2 필수 반영
- P1 필수 반영
- P0 저비용/명확한 것만

반영 후 3-check 재통과 → PR 오픈.

## Step 9: PR 생성

```bash
gh pr create --base dev --head <branch> \
  --title "[<type>] <제목> (#<issue>)" \
  --body "$(cat <<'EOF'
## Summary
<변경 요약>

## 수정
- ...

## 3-check
- [x] lint / typecheck / build

## 코드 리뷰 결과
**리뷰 방식**: pr-review-toolkit code-reviewer 1회 + Codex bot (예정)
- 1회차: P0=N / P1=N / P2=N → merge-ready

## Test plan
- [x] 3-check
- [ ] 배포 후 실사용

Closes #<issue>
EOF
)"
```

## Step 10: 이후 흐름

- Codex bot 자동 리뷰 → `codex-review-loop` 스킬
- 사용자 머지 → `release-flow` 스킬

## 브랜치 정책 요약

| 브랜치 | 용도 | Base |
|---|---|---|
| main | 실서비스 (사용자만 머지) | - |
| dev | 개발 | main |
| feat/N-n | 기능 | dev |
| fix/N-n | 버그 (서비스 전) | dev |
| hotfix/N-n | 실서비스 긴급 | main (→ main + dev 양쪽 머지) |

## Orphan 방지

Squash merge 후 로컬 브랜치에 새 커밋 push 하지 않도록:
1. PR 머지 확인 → 로컬 브랜치 삭제
2. 이후 fix 필요 시 새 브랜치 (`fix/<issue>-<N+1>` from dev)

`orphan-check` 스킬로 감지.
