---
name: session-primer
description: myFitness 신규 세션 진입 시 진행 상태 자동 파악. 최근 릴리즈 · 오픈 PR/이슈 · 백로그 상단 후보를 요약해 이어서 착수할 최적 지점 제시. "새 세션 시작", "myFitness 다음 작업", "이어서 진행", "어디까지 했지" 요청 시 사용. Phase / 릴리즈 완료 후 새 세션에서 첫 발화 시 자동 실행 권장.
---

# Session Primer

myFitness 신규 세션 진입 시 컨텍스트 로드. 이전 세션의 상세는 저장되지 않지만 git · gh · docs · memory 는 그대로 있으니 이걸로 재구성.

## Trigger

- "새 세션 시작 (myFitness)" / "다음 Phase 착수" / "이어서 진행"
- Phase 또는 릴리즈 완료 후 새 세션 첫 발화
- "어디까지 했지" / "지금 상태 요약"
- 신규 세션에서 첫 코드 작업 트리거 (기능 요청 · 이슈 언급) 있을 때 사전 실행

## Step 1: 최근 릴리즈 · 태그 상태

```bash
cd ~/workspace/myFitness  # or PWD
git fetch --tags origin 2>/dev/null
git tag -l 'v*' | sort -V | tail -5
git log --oneline main..dev 2>/dev/null | head -10
git log --oneline -5 main
```

**판단:**
- 태그 최신 vs dev HEAD 차이 → dev 에 릴리즈 대기 커밋 있는지
- main HEAD 가 최신 태그면 릴리즈 완료 상태 · 새 작업 착수 가능
- 태그가 최신 아니면 dev/main 사이 어정쩡한 상태 → 원인 파악 필요

## Step 2: 오픈 PR · 이슈

```bash
gh pr list --state open --limit 5 --json number,title,baseRefName,headRefName
gh issue list --state open --limit 10 --json number,title,labels
```

**판단:**
- 오픈 PR 이 있으면 이전 세션 미완결 → 그것부터 이어서 진행할지 확인
- 새 이슈 없으면 백로그에서 다음 후보 선정 (Step 3)

## Step 3: 백로그 확인

```bash
cat docs/specs/M14-followup.md | head -80
# 또는 최신 M<N>-followup.md 자동 검색
ls docs/specs/M*-followup.md 2>/dev/null | tail -1 | xargs cat | head -80
```

**판단:**
- 우선순위 A (실사용/사용자 요청) 항목이 있으면 우선 후보
- "Status: 진행중" 표기된 항목이 있으면 미완결 → 이어서 진행
- 없으면 우선순위 A → B → C → D 순서로 다음 후보 제시

## Step 4: Memory 인덱스 훑기

- `MEMORY.md` 는 이미 로드됨 (매 세션 자동)
- 지금 세션 요청과 관련된 memory 항목 유무 확인 (예: 새 기능이 Garmin API 관련이면 `project_garmin_api_naive_tz` 참조)

## Step 5: 사용자에게 요약 리포트

다음 형식으로 정리해 제시:

```
## 세션 컨텍스트 요약

**최근 릴리즈**: vX.Y.Z (날짜)
- 포함: #A, #B, #C (요약 한 줄)

**미완결 상태**:
- 오픈 PR: #N ("제목") → dev/main 어디로 · 다음 단계 무엇
- 오픈 이슈: 없음 / N건

**다음 착수 후보** (우선순위 순):
1. A-N: [항목명] — [배경 한 줄]
2. B-N: [항목명] — [배경 한 줄]

**결정 필요**:
- [ ] 위 후보 중 착수할 것 or 새 요청 있는지
```

## 판단 기준

- 최근 세션 컨텍스트 (이 세션이 무엇에 관한지) 는 사용자가 명시하면 존중. 아니면 백로그 우선순위 A 부터 제시.
- 이전 세션에서 진행중이던 브랜치 (`feat/N-M`, `fix/N-M`) 가 로컬에 남아있으면 명시적으로 flag → 이어서 진행할지 새로 시작할지 사용자 판단.
- Codex 리뷰 대기 상태 (open PR + 최근 `@codex review` 코멘트) 도 flag.

## 예시 흐름

```
User: "myFitness 다음 작업"
Me: [Step 1-4 실행]
Me: "세션 컨텍스트 요약: v2.26.1 hotfix 릴리즈 완료 · 오픈 PR/이슈 없음.
     백로그 우선순위 A 후보 3건 (blood-pressure naive-TZ 검증 / 트렌드 date-aware / bot 과거 열람).
     어느 것부터 착수할까?"
```

## 참고

- 관련 스킬: `session-handoff` (세션 종료 전 상태 저장)
- 백로그 문서: `docs/specs/M14-followup.md` (미래에는 `M15-followup.md` 등으로 확장)
- Memory: MEMORY.md 인덱스 항목 순회
