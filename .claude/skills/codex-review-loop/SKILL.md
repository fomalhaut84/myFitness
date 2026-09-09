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

리뷰 body 에서 P0/P1/P2/P3 뱃지 확인. **봇은 `P0` 를 최고 심각도로 쓴다** (봇 네이티브 척도):

- **P0 (최고)**: 데이터 손실 / 보안 / 심각 crash → **반드시 반영**
- **P1**: 로직 / 엣지케이스 / 성능 → **반드시 반영**
- **P2 이하**: 스타일 / 네이밍 → 후속 이슈로 트래킹. **저비용/명확한 것만 즉시 반영**
- **P3 (nit)**: 옵션. 사용자 판단.

> **정정 (pleiades#8 결함 ②).** 이전 판은 `P2 (critical) … P0 (info)` 로 **방향이 반대**였다.
> 그대로면 봇의 **최고 심각도 P0 를 "저비용만 반영"으로 격하**하게 된다. 봇 지적은 봇 표기 그대로
> 다루고, 로컬 사전 리뷰의 단어 척도(critical/major/info)와 섞지 않는다 (`workflow.md` 8절).

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

Codex bot P<N> 반영 (봇 척도 — P0 가 최고). <원인 요약>.

## Fix
- <변경 요약>

## 회귀 검증 (해당 시)
- ...

4종 검증 통과."
git push
```

**4종 검증 필수**: `npm run lint && npm run typecheck && npm run test && npm run build` (`workflow.md` 7단계 — 축약하지 않는다, pleiades#8)

## Step 5: 재리뷰 요청

봇 **P0/P1 을 실제로 반영한 커밋**에만 요청한다. P2 이하만 반영했거나 문서/스펙만 바꾼 경우엔 요청 금지
(단 봇 지적 자체가 문서에 대한 것이면 그 수정은 P0/P1 반영이므로 요청한다 — `workflow.md` 8-2).

```bash
gh pr comment <PR> --body "@codex review"
```

또는 사용자가 "codex 한도 소진" 알림 시 → pr-review-toolkit 서브에이전트로 대체:

```
Agent(subagent_type: "pr-review-toolkit:code-reviewer", model: "opus",
      prompt: "Review branch <feat/N-1> vs dev. Focus: <focus>.
      Do NOT flag: <pre-emptive coverage list>.")
```

> **대체는 일반 PR 에만 — 릴리즈 PR 은 대체 불가 (pleiades#8 · fin #492 2회차 P1).** 봇이 안 돌면(쿼터 소진·장애)
> **일반 PR** 은 8-0 경로대로 — 에이전트 필수 경로는 사전 에이전트 리뷰(critical/major = 0), self-review 경로는 self-review + 4종 검증 — 로 완료하되 PR body 에 `봇: 미실행 (쿼터 소진, YYYY-MM-DD)` 를 명시하고
> 회복 후 `@codex review`. **핫픽스 PR** 은 8-3 봇 불가 표의 핫픽스 행(사전 리뷰 + 사용자 "봇 없이 머지" 명시 승인). **릴리즈 PR(dev → main)은 봇 회복까지 대기한다** — `봇 P0/P1 = 0` 게이트를 에이전트 리뷰로 우회하지 않는다
> (`workflow.md` 8-3 · `release-flow` 봇 리뷰 게이트).

## Step 5-1: PR body `## 코드 리뷰 결과` 갱신 (매 라운드 · `workflow.md` 8-6)

PR 생성 시점의 `봇: 리뷰 대기` 를 실제 라운드 요약과 최종 상태로 바꾼다. `gh pr edit --body` 는 **전체 교체**다:

```bash
gh pr view <PR> --json body -q .body > /tmp/body.md      # 현재 body 를 받아
# … `## 코드 리뷰 결과` 섹션만 편집 …
gh pr edit <PR> --body-file /tmp/body.md                 # 전체를 다시 넣는다. Closes/요약이 남았는지 확인
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
2. PR comment 로 "이 P<N> 은 설계 방침상 반영하지 않습니다" 명시 — **P2 이하에 한한다.** 봇 P0/P1 은 8-3 대로 0 이 될 때까지 머지하지 않으며, 방침상 미반영으로 두려면 사용자 명시 판단이 필요하다
3. 별도 이슈로 트래킹 후 마무리

## 예시 세션 흐름

```
User: https://github.com/fomalhaut84/myFitness/pull/226#pullrequestreview-4690548424
Me:   [Step 1] gh api ... → "2건 P1 지적 확인: (1) 세션 resume 시 stale (2) formatPace 반올림"
      [Step 3] 반영 방향: (1) dynamic context 이동 (2) total 먼저 round
      [Step 4] git add + commit + push
      [Step 5] gh pr comment "@codex review"
```
