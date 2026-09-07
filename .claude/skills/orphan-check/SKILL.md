---
name: orphan-check
description: Squash merge 후 로컬 브랜치에 push 된 커밋이 dev 에 반영 안 된 상태 (orphan) 를 감지. dev pull 후 로컬 브랜치와 원격 dev 비교. "머지완료" 알림 받은 후 자동 체크, "이 커밋이 dev 에 있어?", "orphan 있어?" 요청 시 사용.
---

# Orphan Check

Squash merge 특성상 로컬 브랜치의 여러 커밋 중 첫 커밋만 dev 로 압축된다. 이후 push 된 커밋은 dev 에 반영 안 됨 → 이 세션에서 3회 발생 (fix/223-2, fix/223-3, fix/223-5).

## Trigger

- 사용자 "머지완료" 알림 직후 자동 체크
- "이 브랜치 커밋이 dev 에 다 있어?"
- 새 fix 커밋 push 하기 전 확인

## Step 1: 상태 확인

```bash
# 최신 dev
git fetch origin

# 현재 브랜치 vs origin/dev
CURRENT=$(git branch --show-current)
echo "Current: $CURRENT"

# 로컬 브랜치 마지막 3 커밋
git log $CURRENT --oneline -3

# 원격 dev 최신 3 커밋
git log origin/dev --oneline -3
```

## Step 2: PR 머지 상태

```bash
# 브랜치와 연결된 PR
gh pr list --head $CURRENT --state merged --limit 1 --json number,mergedAt

# 대상 PR 이 이미 머지됐고 로컬 브랜치에 이후 커밋이 있으면 → orphan
```

## Step 3: Orphan 감지 로직

**시나리오**:

| 조건 | 결과 |
|---|---|
| PR state=OPEN + 로컬 커밋 있음 | 정상 진행 중 |
| PR state=MERGED + 로컬 마지막 커밋이 PR merged commit 이전 | 정상 (다 반영됨) |
| **PR state=MERGED + 로컬 마지막 커밋이 mergedAt 이후** | **⚠ ORPHAN** |

## Step 4: Orphan 회수

orphan 감지 시:

```bash
# dev 최신 pull
git checkout dev && git pull

# 새 브랜치 (원 이슈 번호 유지, N+1)
git checkout -b <type>/<issue>-<N+1>

# orphan 커밋을 새 브랜치에 재적용
# 방법 A: git cherry-pick (한 개씩)
git cherry-pick <orphan-hash>

# 방법 B: 파일 직접 편집 (여러 커밋 통합)
# — 원 브랜치 diff 확인
git diff origin/dev..$OLD_BRANCH -- <file>
# — 최종 목표 상태로 파일 재작성 후 하나의 커밋
```

**권장**: 통합 재작성 (여러 커밋 → 하나) — 리뷰 반복 사이클로 orphan 이 여러 개면 최종 상태만 반영. 중간 커밋 (되돌린 fix 등) 은 노이즈.

## Step 5: 새 PR

```bash
git push -u origin <type>/<issue>-<N+1>
gh pr create --base dev --head <type>/<issue>-<N+1> \
  --title "[<type>] <원 이슈 후속> (#<issue>)" \
  --body "PR #<원 PR> 머지 후 orphan 됐던 후속 fix 통합 반영.

## 원 리뷰
- <리뷰 URL>

## 수정
- ...

Closes #<issue> (재오픈 없이 후속 fix)"
```

## 자동 검사

이 스킬이 트리거되는 시점:

- release-flow 이 "머지완료" 처리 후 브랜치 삭제 전
- codex-review-loop 이 재리뷰 결과 반영 커밋 push 전
- workflow-conductor 이 새 브랜치 만들기 전

## 예시 세션 (이번 세션에서 발생)

```
User: 머지완료
Me:   [orphan-check] gh pr view 226 → MERGED at 02:36:56Z
      git log fix/223-2 → 마지막 커밋 02:40:xx (orphan!)
      → dev pull → fix/223-3 브랜치 → 목표 상태 통합 재작성 → PR #227
```

## 회피 팁

- 리뷰 반영 커밋 push 전 반드시 PR 상태 확인 (`gh pr view <N> --json state`)
- 사용자 "머지완료" 알림 = 즉시 orphan-check 실행
- 여러 fix 커밋 예상되면 처음부터 통합 재작성 계획
