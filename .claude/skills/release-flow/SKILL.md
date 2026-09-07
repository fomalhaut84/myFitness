---
name: release-flow
description: dev → main 릴리즈 흐름 표준화. 사용자 "머지완료" (이슈 PR 머지 알림) → 이슈 close + 브랜치 정리 → dev→main 릴리즈 PR 생성 → 사용자 "머지완료" (릴리즈 PR) → main tag push + GitHub Release 생성. semver 자동 판단, Release 노트 템플릿 제공.
---

# Release Flow

myFitness 릴리즈 표준 절차.

## Step 1: 이슈 PR 머지 후 정리

사용자 "머지완료" 알림 시:

```bash
gh issue comment <N> --body "완료: PR #<PR>, 머지일 $(date -u +%Y-%m-%d)"
gh issue close <N>
git checkout dev && git pull
git branch -d <branch>
```

## Step 2: 릴리즈 판단

머지된 이슈가 릴리즈 대상인지 결정:

- **바로 릴리즈**: 배포 필요한 실사용 이슈
- **묶어서**: 여러 이슈 축적 후 한꺼번에

사용자에게 의사 확인. "릴리즈해줘" or "다음 이슈 착수" 갈림길.

## Step 3: Semver 판단

`main` 최신 태그 확인:

```bash
git describe --tags --abbrev=0
```

새 버전 결정:

| 종류 | Bump | 예시 |
|---|---|---|
| Breaking change / Phase 완료 / M 마일스톤 | major | v2.x.x → v3.0.0 |
| 신규 기능 (feature 이슈) | minor | v2.10.x → v2.11.0 |
| 버그 수정 / 리팩터 / infra | patch | v2.11.0 → v2.11.1 |
| Hotfix | patch | v2.11.1 → v2.11.2 |

여러 종류 섞이면 가장 큰 것 선택.

## Step 4: 릴리즈 PR 생성

```bash
gh pr create --base main --head dev \
  --title "v<X.Y.Z> — <핵심 변경>" \
  --body "$(cat <<'EOF'
## v<X.Y.Z>

<개요 1~2문장>

## 수정

<이슈별 요약>

## 배포

- DB migration: 있음/없음
- pm2 restart 만 필요 / (다른 변경)

## 코드 리뷰

<리뷰 사이클 요약, P0/P1/P2 카운트>

## 검증 계획 (배포 후)

- ...

## 후속

- ...
EOF
)"
```

## Step 5: 릴리즈 PR 리뷰 대응

Codex bot 자동 리뷰가 릴리즈 PR 에도 붙음. 반영 방식:

- **새 브랜치 (`fix/<issue>-<N>` from dev)** → dev PR → 머지 → 릴리즈 PR 자동 반영
- 릴리즈 PR 자체에 직접 커밋 X

## Step 6: 사용자 머지 대기

**사용자만 머지 (memory: feedback_release_via_pr)**. 자동 머지 절대 금지.

### ⚠️ 릴리즈 PR 은 반드시 merge commit (squash 금지)

dev → main 릴리즈 PR 을 **squash 로 머지하면 main 과 dev 의 공통 조상이 끊긴다.**
squash 는 dev 커밋들의 이력을 버리고 새 커밋 하나를 만들기 때문에, 이후 dev→main PR 마다
git 이 양쪽을 독립 변경으로 보고 add/add · content 충돌을 일으킨다 (내용은 동일한데도).

**릴리즈 PR 본문 최상단에 이 안내를 반드시 넣을 것:**

```markdown
> **⚠️ 머지 방식: "Create a merge commit" 을 사용하세요. squash 금지.**
> squash 하면 main↔dev 공통 조상이 끊겨 다음 릴리즈 PR 이 충돌합니다.
```

feat/fix → dev PR 은 squash 로 무방하다. **dev → main 만 merge commit.**

### 이미 squash 된 경우 — back-merge 로 복원

증상: 릴리즈 PR 이 `mergeable: CONFLICTING` 인데 `git diff origin/dev origin/main` 상
main 에만 있는 내용은 없음 (dev 가 상위집합).

```bash
# 1. main 에 dev 에 없는 내용이 정말 없는지 먼저 확인
git fetch origin
git diff origin/dev origin/main --stat

# 2. 검증용 브랜치에서 back-merge (dev 쪽 내용 채택)
git checkout -b tmp/backmerge-verify origin/dev
git merge origin/main --no-commit
for f in <충돌 파일들>; do git checkout --ours "$f" && git add "$f"; done

# 3. 결과가 dev 트리와 동일한지 확인 — 빈 결과여야 함
git diff origin/dev --stat

git commit -m "chore: main(vX.Y.Z) 를 dev 로 back-merge — squash 로 끊긴 이력 복원"

# 4. 이후 충돌이 사라지는지 확인
git merge-tree --write-tree origin/main HEAD | grep -i conflict   # 출력 없어야 함

# 5. 3-check 후 dev 로 반영
git checkout dev && git merge tmp/backmerge-verify --ff-only
git push origin dev
```

**back-merge 는 PR 로 돌리지 말 것** — squash 머지되면 merge commit 이 사라져 이력이
복원되지 않는다. 내용 변화가 0 이라 리뷰할 diff 도 없다. 사용자 확인 후 dev 로 직접 push.

## Step 7: 태그 + Release (사용자 머지 후)

```bash
git checkout main && git pull
git tag v<X.Y.Z>
git push origin main --tags

gh release create v<X.Y.Z> \
  --title "v<X.Y.Z> — <핵심 변경>" \
  --notes "$(cat <<'EOF'
## v<X.Y.Z>

<개요>

### 수정

**<핵심 기능>** (#<issue>, PR #<PR>)

- <변경 1>
- <변경 2>

### 배포

- DB migration 있음/없음
- pm2 restart 자동 (Deploy on Release)

### 검증 계획 (배포 후)

- ...

### 후속

- ...
EOF
)"
```

## Step 8: 사용자 알림 대기

Deploy on Release 워크플로우 자동 트리거. 사용자 "배포완료" 알림 후:
- 오늘 검증 지점 안내
- 다음 이슈 착수 or 세션 마무리 제안

## 특수 사례

### Hotfix

`main` 에서 브랜치 → main + dev 양쪽 머지:

```bash
git checkout main && git checkout -b hotfix/<issue>-<n>
# ... 수정 ...
gh pr create --base main --head hotfix/<issue>-<n>
gh pr create --base dev  --head hotfix/<issue>-<n>
```

### Deploy 실패

`Deploy on Release` 워크플로우 실패 시 → `ops-analyst` 로 라우팅:
```bash
gh run list --workflow=deploy.yml --limit 3
gh run view <id> --log
```

### 태그 이미 존재

```bash
git tag -l v<X.Y.Z>
```
사용자에게 재확인 요청. 자동 bump 금지.

## 검증 리마인더 (배포 후)

배포 완료 알림 후 사용자에게:
- 웹 UI 즉시 확인 지점
- 텔레그램 알림 (cron 리포트 예정 시각)
- pm2 로그 확인 명령 (필요 시)

## PR body / Release 노트 톤

- 한글 중심, 코드 블록 `bash`/`typescript` 명시
- 이슈/PR 번호 (#<N>) 링크
- Known limitations / 후속 계획 명시
- 검증 지점 체크리스트
