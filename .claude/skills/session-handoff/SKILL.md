---
name: session-handoff
description: myFitness 세션 종료 전 진행 상황을 백로그 문서/memory 에 저장해 다음 세션 인계 준비. "여기서 마무리", "오늘 정리", "다음 세션에 이어서", "세션 정리", "마무리 정리" 요청 시 사용. 릴리즈 완료 후 세션을 자연 종료하는 시점에도 자동 실행.
---

# Session Handoff

세션 종료 전 상태 외부화. 컨텍스트 압축·재시작 후에도 진행 상태 복원 가능.

## Trigger

- "여기서 마무리" / "오늘 정리" / "다음 세션에 이어서"
- 릴리즈 완료 후 (v2.26.1 태그 push 후 검증까지 완료된 자연 종료 시점)
- Phase 완료 후 백로그 갱신 요청
- 세션 후반 컨텍스트 오염 감지 시 사용자 제안

## Step 1: 이번 세션의 진행 결과 요약

git · gh 로 세션 중 실제 발생한 변경 수집:

```bash
# 이번 세션 시작 시점 대비 커밋 (최근 태그 이후 or 사용자 지정 시각)
LAST_TAG=$(git describe --tags --abbrev=0)
git log --oneline "$LAST_TAG"..HEAD

# 이번 세션 오픈/머지한 PR 목록
gh pr list --state merged --limit 15 --json number,title,mergedAt --jq '.[] | select(.mergedAt > "2026-XX-XX")'  # 세션 시작 날짜

# 열려있는 PR/이슈 (다음 세션 인계 대상)
gh pr list --state open
gh issue list --state open --limit 10
```

## Step 2: 백로그 문서 갱신

`docs/specs/M<N>-followup.md` (최신) 열어서:

### 완료 항목 이동
- 이번 세션에서 완료된 백로그 항목이 있으면 "완료 (참고)" 섹션으로 이동
- 완료 표기 형식: `- **Status**: 완료 (vX.Y.Z, PR #NNN)`

### 신규 발견 항목 추가
- 세션 중 Codex 리뷰 · 사전 리뷰 · 실사용에서 발견된 새 후속 이슈
- 우선순위 (A/B/C/D) 판단해 삽입
- 형식:
  ```
  ### X-N. [제목]
  - **배경**: [한두 문장]
  - **스코프**: [무엇을 · 어디서 · 어떻게]
  - **주의**: [있으면]
  ```

### "현재 상태" 섹션 최신화
- 최근 릴리즈 태그 갱신
- 새로 발견된 memory-worthy 사실 반영

## Step 3: Memory 갱신 (있으면)

**저장 후보**:
- 이번 세션에서 발견한 API 계약 · 도메인 규칙 (예: Garmin naive-TZ)
- 반복 발생 위험 있는 사용자 선호 · feedback
- 프로젝트 구조 변화가 다른 세션에서도 유효한 것

**저장하지 말 것**:
- 특정 라운드 Codex 지적의 세부 (커밋 log 에 남음)
- 코드 변경 자체 (git blame · git log 에 남음)
- 이번 세션 임시 결정 (다른 세션에서 적용 안 될 것)

## Step 4: 열린 PR 상태 문서화

세션 종료 시점에 오픈 상태로 남는 PR 이 있으면:

```
### 인계 (다음 세션에서 이어갈 것)
- **PR #NNN** ([상태]) — [현재 대기 지점]
  - 예: "Codex 리뷰 대기중, Round 3 · 봇 P1 1건 반영 완료 후 재리뷰 요청"
  - 예: "사용자 머지 대기 (dev 대상)"
```

이걸 백로그 문서 최상단 "현재 상태" 섹션에 추가.

## Step 5: 브랜치 · 로컬 상태 확인

```bash
# 로컬 브랜치 orphan / 미정리
git branch | grep -v main | grep -v dev
git status --short
```

- 로컬에만 있는 브랜치 (원격 없음) → 정리 or 유지 판단
- 커밋 안 된 변경 → 저장 후 세션 종료 or 명시적 discard 확인

## Step 6: 사용자에게 인계 요약

```
## 세션 인계 요약

**이번 세션 결과**:
- 릴리즈: vA.B.C, vA.B.D
- 머지된 PR: #N, #M, #K (3건)
- 새로 저장된 memory: [name] — [한 줄 설명]

**다음 세션 인계 지점**:
- 열린 PR: 없음 / #N (상태)
- 백로그 최상단 후보: A-N ([항목명])
- 특이 사항: [있으면]

**신규 세션 진입 시**: `session-primer` 스킬로 위 컨텍스트 재로드 가능.
```

## 주의

- **PR 머지는 사용자 판단** — handoff 스킬이 자동 머지 절대 금지 (릴리즈 정책 유지)
- **memory 저장은 신중** — 반복 유효한 것만. 세션 임시 상태는 백로그 문서로.
- **백로그 문서 갱신은 dev PR 로** — 문서만이라 self-review, 4종 검증(`lint / typecheck / test / build`)도 문서만 (lint 는 통과할 것)
- 사용자가 "그냥 마무리, 문서 갱신 X" 요청하면 Step 2/3 건너뛰고 Step 6 만 수행

## 참고

- 관련 스킬: `session-primer` (다음 세션 진입 시 재로드)
- 백로그 문서: `docs/specs/M<N>-followup.md`
- Memory 경로: `~/.claude/projects/-Users-sagan-workspace-myFitness/memory/`
