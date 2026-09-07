---
name: codex-review-loop
description: Codex bot 또는 pr-review-toolkit 리뷰 URL 을 받으면 자동으로 gh api 로 fetch → path/line/body 요약 → fix 방향 판단 → 반영 커밋 → push → 재리뷰 요청까지 실행하는 절차. `github.com/.../pull/<N>#pullrequestreview-<id>` 형식 URL, `@codex review` 결과, "리뷰 확인해줘" 요청 시 사용.
---

# Codex Review Loop

Codex bot / pr-review-toolkit 리뷰 사이클을 표준화한 절차.

## Trigger

- 사용자가 `.../pull/<PR>#pullrequestreview-<review_id>` URL 붙여넣기
- "리뷰 확인해줘" + PR 번호
- `@codex review` 요청 결과 대기 후 재확인

## Step 1: 리뷰 fetch

URL 에서 `review_id` 추출 후:

```bash
gh api "repos/fomalhaut84/myFitness/pulls/<PR>/comments?per_page=100" \
  --jq '.[] | select(.pull_request_review_id == <review_id>) | {path, line, body}'
```

여러 지적일 수 있으니 결과 전부 요약. path/line/body 를 사용자에게 보여줌.

## Step 2: Severity 판단

리뷰 body 에서 P2/P1/P0/P3 뱃지 확인:

- **P2 (critical)**: 데이터 손실 / 보안 / 심각 crash → **반드시 반영**
- **P1 (major)**: 로직 / 엣지케이스 / 성능 → **반드시 반영**
- **P0 (info)**: 스타일 / 네이밍 → **저비용/명확한 것만 반영**
- **P3 (nit)**: 옵션. 사용자 판단.

## Step 3: Fix 방향 결정

- **명확한 fix**: 직접 반영
- **상충 리뷰**: 이전 리뷰와 방향이 다름 (예: 이번 세션의 activityType whitelist vs contains, weight progressPct 부호, personalGoalNote 정중어) → 사용자 판단 요청. 무한 사이클 진입 금지.
- **범위 초과**: 별도 이슈로 트래킹 + PR comment 응답
- **트레이드오프 명시**: 스펙 문서 §Known limitations 에 기록

## Step 4: 반영 커밋

브랜치 확인 후:

```bash
git status --short
# ... 파일 편집 ...
git add -A && git commit -m "fix(<scope>): <desc> (#<issue>)

Codex bot P<N> 반영. <원인 요약>.

## Fix
- <변경 요약>

## 회귀 검증 (해당 시)
- ...

3-check 통과."
git push
```

**3-check 필수**: `npm run lint && npm run typecheck` (build 는 리팩터 큰 경우만)

## Step 5: 재리뷰 요청

```bash
gh pr comment <PR> --body "@codex review"
```

또는 사용자가 "codex 한도 소진" 알림 시 → pr-review-toolkit 서브에이전트로 대체:

```
Agent(subagent_type: "pr-review-toolkit:code-reviewer", model: "opus",
      prompt: "Review branch <feat/N-1> vs dev. Focus: <focus>.
      Do NOT flag: <pre-emptive coverage list>.")
```

## Step 6: 릴리즈 PR 리뷰 특수 처리

**PR 이 dev → main (릴리즈 PR)** 이면:
- 리뷰 반영은 새 브랜치 (`fix/<issue>-<N+1>` from dev) 로 진행
- Dev 로 PR 후 머지 → 릴리즈 PR 자동 반영
- 릴리즈 PR 자체에 직접 커밋 X

## Step 7: Orphan 커밋 감지

Squash merge 후 로컬 브랜치에 새 커밋 push 하지 않도록 주의:

```bash
gh pr view <PR> --json state,mergedAt
# state=MERGED 이면 이후 커밋은 orphan
```

`orphan-check` 스킬로 감지 → 새 브랜치로 회수.

## 무한 사이클 방지

같은 파일/영역에서 3라운드+ 상충 지적이 반복되면:
1. 스펙 문서 §Known limitations 에 결정 사항 기록
2. PR comment 로 "이 P<N> 은 설계 방침상 반영하지 않습니다" 명시
3. 별도 이슈로 트래킹 후 마무리

## 예시 세션 흐름

```
User: https://github.com/fomalhaut84/myFitness/pull/226#pullrequestreview-4690548424
Me:   [Step 1] gh api ... → "2건 P2 지적 확인: (1) 세션 resume 시 stale (2) formatPace 반올림"
      [Step 3] 반영 방향: (1) dynamic context 이동 (2) total 먼저 round
      [Step 4] git add + commit + push
      [Step 5] gh pr comment "@codex review"
```
