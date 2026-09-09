# 개발 워크플로우

모든 기능 개발은 이 워크플로우를 따른다. 단계를 건너뛰지 않는다.

## 브랜치 전략

- `main`: 실서비스 코드. 직접 커밋 금지.
- `dev`: 개발 코드. hotfix를 제외한 모든 브랜치는 dev에서 생성.
- `feat/<issue-number>-<n>`: 기능 개발. dev에서 생성 → dev로 PR.
- `fix/<issue-number>-<n>`: 버그 수정 (서비스 단계 이전). dev에서 생성 → dev로 PR.
- `hotfix/<issue-number>-<n>`: 실서비스 버그. main에서 생성 → main, dev 양쪽 머지.

```
main ─────────────────●────────────●──── (릴리즈 태그)
                      ↑            ↑
dev ──┬──┬──┬────────merge────────merge──
      │  │  │
      │  │  └─ fix/15-sync-error
      │  └─── feat/12-garmin-sync
      └───── feat/8-dashboard


hotfix: main → hotfix/20-crash → main + dev 양쪽 머지
```

## 릴리즈 전략

- dev → main 머지 후 태그 생성.
- 태그 형식: `v{major}.{minor}.{patch}` (예: `v1.0.0`, `v1.2.1`)
- GitHub에서 릴리즈 생성 + 릴리즈 노트 작성 후 배포.

**릴리즈도 PR 을 거친다.** "`main` 직접 커밋 금지"와 "머지는 사용자가 직접"은 릴리즈에도 적용된다.
**릴리즈 PR 의 `Closes`:** 릴리즈 PR 은 누적 변경을 옮기는 것이라 대응하는 이슈가 없다.
9절 `Closes` 규칙의 **예외**로 두고, 본문에 이번 릴리즈에 포함된 이슈 목록을 적는다.

```bash
# 1. dev → main PR 생성 (Claude) — body 는 **`release-flow` Step 4 의 전체 템플릿**(머지 모드 경고 · 개요 · 수정 · 배포 ·
#    코드 리뷰 · 검증 계획 · 후속)을 그대로 쓴다. 여기 요약본은 필수 항목만 보여준다 — 실제 생성은 그 템플릿으로.
gh pr create --base main --head dev --title "Release v1.0.0" --body "$(cat <<'EOF'
> **⚠️ 머지 방식: "Create a merge commit" 을 사용하세요. squash 금지.**
> squash 하면 main↔dev 공통 조상이 끊겨 다음 릴리즈 PR 이 충돌합니다.

## 포함 이슈
- …

## 코드 리뷰 결과        ← 8-6 필수 섹션. 헤딩은 이 문자열로 고정(갱신 단계가 찾는다). 생성 시점엔 봇 결과가 없다
- 봇: 리뷰 대기
EOF
)"
#    봇 리뷰가 끝나면 body 의 `## 코드 리뷰 결과` 를 갱신한다 (8-6) — `gh pr edit --body` 는 전체 교체이므로
#    `gh pr view --json body` 로 받아 그 섹션만 바꾼 뒤 `--body-file` 로 다시 넣는다

# 2. 봇 리뷰 게이트 — 8-2·8-3 을 그대로 거친다. 봇 P0/P1 = 0 이 될 때까지 머지하지 않는다.
#    수정이 필요하면 dev 로 fix/<issue>-<n> PR 을 태워 반영 → @codex review
#    (릴리즈 PR 자체에 직접 커밋 X — `release-flow` Step 5)

# 3. 사용자가 머지 (⚠️ merge commit 으로. squash 금지 — `release-flow` Step 6)

# 4. 머지 확인 후 태그 (Claude)
git checkout main && git pull
git tag v1.0.0
git push origin --tags
gh release create v1.0.0 --title "v1.0.0" --notes "릴리즈 노트 내용"
```

> **정정 (pleiades#8 결함 ①).** 이전 절차는 로컬에서 `git merge dev` → `git push origin main --tags` 로
> **`main` 을 직접 갱신·push** 했다:
> `git checkout main && git pull` / `git merge dev` / `git tag v1.0.0` / `git push origin main --tags`.
> 같은 문서의 "`main` 직접 커밋 금지"·"머지는 사용자가 직접"과 모순이고, `main` 이 보호되면 절차 자체가
> 실패하며, 보호가 없으면 **리뷰 없는 릴리즈**가 통과한다. 릴리즈는 곧장 실서비스로 가므로
> 봇 게이트(8-2)를 사용자 머지 **앞에** 둔다. 태그 push 는 머지 확인 후 `git push origin --tags` 만 한다.

버전 기준:
- major: 큰 기능 추가 또는 Breaking change (Phase 완료 등)
- minor: 기능 추가 (이슈 단위)
- patch: 버그 수정, hotfix

## 단계별 규칙

### 1. 기획
사용자 요청 → 목적·범위·의존성 정리 → 사용자 승인 후 다음 단계.

### 2. 기획 문서화
`docs/specs/<issue-number>-<feature>.md` 에 작성.
포함: 목적, 요구사항(체크박스), 기술 설계, 테스트 계획, 제외 사항.

### 3. GitHub 이슈 생성
```bash
gh issue create --title "[Phase N] 기능명" --body "$(cat docs/specs/...)" --label "phase-N,feature"
```
라벨: `phase-1`~`phase-N`, `feature`/`bug`/`chore`, `P0`/`P1`/`P2` (이 `P0`/`P1`/`P2` 는 **GitHub 이슈 우선순위 라벨**이다. 8절의 리뷰 심각도 척도와는 별개)

### 4. UI/UX 디자인

스펙 문서를 기반으로, 구현 전에 **디자인을 먼저** 확정한다.
`frontend-design` 스킬을 활용하여 프로토타입을 생성한다.

**절차:**

1. 스펙 문서의 UI 요구사항을 정리 (페이지, 컴포넌트, 인터랙션 목록)
2. `frontend-design` 스킬로 디자인 시안 생성:
   - Design Thinking: 목적, 톤, 차별화 포인트 결정
   - React/HTML 프로토타입으로 실제 작동하는 시안 제작
   - 반응형(모바일/데스크톱), 다크 테마 반영
3. 사용자에게 시안 공유 → 피드백 → 수정 반복
4. 최종 승인된 디자인을 `docs/designs/<issue-number>-<feature>/` 에 저장

**산출물:**
```
docs/designs/<issue-number>-<feature>/
├── prototype.jsx          # 승인된 React 프로토타입 (참조용)
├── design-notes.md        # 디자인 결정사항 (컬러, 폰트, 레이아웃 근거)
└── screenshots/           # 주요 화면 스크린샷 (선택)
```

**디자인 범위 판단:**
- UI가 있는 기능 (페이지, 대시보드, 차트, 폼) → **필수** 디자인 단계
- 백엔드 전용 (API, cron, DB 마이그레이션) → 디자인 단계 **건너뛰기**

### 5. 구현 계획
변경 파일 목록, 구현 순서, 패키지 추가, DB 마이그레이션 여부 정리.
**승인된 디자인 파일을 구현 레퍼런스로 참조.**
사용자 승인 후 코딩 시작.

### 6. 개발
```bash
git checkout dev && git pull
git checkout -b feat/<issue-number>-<n>
```
커밋: `<type>(<scope>): <desc> (#<issue>)` — 하나의 논리적 변경 = 하나의 커밋.
UI 구현 시 `docs/designs/` 의 승인된 프로토타입을 기준으로 개발.

### 7. 테스트
```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
전부 통과해야 다음 단계. 실패 시 수정 후 재실행. 건너뛰기 금지.

### 8. 코드 리뷰

두 단계 리뷰. 목적: **수정 필수 등급**을 걸러내되 재리뷰 사이클과 토큰 소비를 최소화.

> **심각도 척도가 둘이고 방향이 반대다 (pleiades#8 결함 ②).** 로컬 사전 리뷰(8-1)는 **단어**
> (critical / major / info), GitHub Codex bot(8-2)은 **`P0` 가 최고**인 네이티브 척도를 쓴다. 섞어 쓰지 않는다.
> 이전 문서는 로컬 프롬프트에서 `P0 (info)` … `P2 (critical)` 로 관례와 반대로 정의했고, 그 결과 8-2 의
> "P0 는 원칙적으로 무시"가 **봇의 최고 심각도를 버리라는 지시**가 됐다.

#### 8-0. 적용 조건 (필수 vs self-review)

변경 규모·성격에 따라 사전 리뷰 강도를 조절.

| 변경 성격 | 사전 리뷰 (8-1) | 근거 |
|---|---|---|
| 애플리케이션 코드 (`src/**` 로직) | **에이전트 리뷰 필수** | 로직 버그·엣지케이스 커버 |
| DB 스키마/마이그레이션 | **에이전트 리뷰 필수** | 데이터 손실·정합성 위험 |
| API route / MCP 도구 신설·수정 | **에이전트 리뷰 필수** | 경계 계층 (보안·오남용) |
| Config / infra (`.github/**`, `tailwind.config.ts`, etc.) 소규모 | **self-review** (내가 diff 훑고 4종 검증) | 파급 국소 |
| 문서/스펙만 (`docs/**`, `*.md`) | **self-review** | 실행 코드 아님 |
| 디자인 시안 (`docs/designs/**`) | **self-review** | 실행 코드 아님 |

self-review 시에도 **4종 검증** (`lint / typecheck / test / build`) 필수, PR body 리뷰 결과 섹션에 "self-review (변경 성격: <카테고리>)" 명시.

> **정정 (pleiades#8 · 3-check).** 이전 서술은 self-review 조건과 8-1 재통과 조건을
> `3-check (lint / typecheck / build)` 로 적어 **7단계의 4종 검증(`lint && typecheck && test && build`)과 모순**됐다.
> myFitness 의 `npm run test` 는 vitest 가 아니라 **verify 스크립트 2개**다 — 테스트 프레임워크가 없다는 것과
> **실행할 것이 없다는 것은 다르다.** 검증 세트는 7단계의 4종이 정본이고, 이 절은 그것을 축약하지 않는다.

> **정정 (pleiades#8 결함 ⑥).** 이전 표기 `self-review only` 는 쓰지 않는다. 8-0 에서 self-review 경로를
> 타더라도 **봇 리뷰(8-2)는 그대로 돌고 8-3 이 그 결과에 완료를 건다.** `only` 라고 적으면 실제로 거친
> 필수 단계를 빠뜨린 기록이 되고 바로 아래 봇 카운트와도 모순된다. 사전 **에이전트** 리뷰를 생략했을
> 뿐이라는 뜻으로 `self-review` 를 쓴다.

#### 8-1. 로컬 사전 리뷰 (에이전트, 조건부 필수)

**pr-review-toolkit code-reviewer 에이전트 1회.** 8-0 조건에 따라 필수인 경우 자체 검증 없이 PR 오픈 금지.

```
Task(subagent_type="pr-review-toolkit:code-reviewer", prompt="""
Review branch <feat/N-1> vs dev in <repo path>.

## Context
<1~3문장으로 이번 변경이 하는 일>

## Focus files
<주요 파일 목록>

## Severity
- critical: 보안·데이터손실·크래시
- major: 로직·엣지케이스·성능
- info: 스타일·네이밍

## Output
각 이슈: severity + file:line + 설명 + fix.
최종 counts: critical/major/info.
""")
```

**심각도별 대응 (사전 리뷰 — 로컬 단어 척도):**
- **critical**: 반드시 수정.
- **major**: 반드시 수정.
- **info**: 대체로 반영하되, 저비용/명확한 것만. 큰 리팩터를 요구하는 info 는 후속 이슈로 분리.

critical/major 반영 후 **4종 검증** (`lint / typecheck / test / build`) 재통과 → PR 오픈.

#### 8-2. Codex bot 자동 리뷰 (PR 오픈 후)

GitHub 이 PR 오픈 시 자동으로 Codex bot 리뷰 트리거. **매 커밋마다 재실행되지 않음** — 사용자가 `@codex review` 코멘트를 남길 때만 재리뷰.

**봇은 `P0` 를 최고 심각도로 쓴다** — 8-1 의 단어 척도와 방향이 반대다. 봇 지적은 **봇의 표기 그대로** 다룬다:

**심각도별 대응 (Codex bot — 봇 네이티브 척도):**
- **P0 (최고)·P1**: 반드시 수정.
- **P2 이하**: 후속 이슈로 트래킹. 저비용·명확한 것만 즉시 반영. Codex 재리뷰마다 쿼터가 새로 청구됨.

**재리뷰 절제:**
- P0/P1 을 실제로 반영한 커밋에 한해 `@codex review` 요청.
- P2 이하만 반영했거나 문서/스펙만 바꾼 경우엔 재리뷰 요청 금지 (단 **봇 지적 자체가 문서에 대한 것이면 그 수정은 P0/P1 반영**이므로 요청한다).

#### 8-3. 반복 루프

```
사전 리뷰 (필수인 경우) → critical/major = 0 → PR 오픈
  ↓
Codex bot 리뷰 → P0/P1 있음? → Yes → 수정 → 7단계 검증 재통과 → 커밋 → @codex review
                             → No  → ✅ 통과 (P2 이하는 후속 이슈)
```

**봇 수정 후에는 반드시 재검증한다.** 7단계 검증은 그 수정 **이전**의 결과다.

최종 통과 시: `✅ 코드 리뷰 통과 (사전 critical/major: 0건 · 봇 P0/P1: 0건)` 출력.
**봇이 돌 수 없는 경우**(쿼터 소진 등)는 경로별로 다르다 — pleiades `workflow.md` 9-3 봇 불가 표와 동일:

| PR | 봇 불가 시 |
|---|---|
| **일반 PR** | `봇: 미실행 (사유, YYYY-MM-DD)` 를 적고 회복 후 `@codex review`. 사전 에이전트 리뷰(critical/major = 0)가 있으면 그것이 완료 판정 |
| **핫픽스 PR** (긴급 수정 절) | 사전 에이전트 리뷰(critical/major = 0)가 완료 판정 **+ 사용자가 "봇 없이 머지" 를 명시 승인**. 실서비스로 직행하므로 묵시 승인은 없다. `봇: 미실행 (사유, YYYY-MM-DD)` 표기 |
| **릴리즈 PR** (dev → main) | **봇 회복까지 대기** — 릴리즈는 곧장 실서비스로 가고 핫픽스와 달리 긴급성이 없다. 보류가 실서비스 장애를 연장하는 경우에만 핫픽스 행으로 내려간다 |

**매 리뷰 결과는 사용자에게 요약 보고.**

#### 8-5. 회귀 방지 테스트 (수정 필수 등급 반영 시)

봇/에이전트가 잡은 **수정 필수 등급을 고칠 때는 그 이슈를 노출하는 회귀 테스트를 함께 추가한다.** 목적: 같은 버그가 리팩터/변경으로 재발하지 않도록 CI 에서 계속 검증.

**추가 시점**:
- 로직/엣지케이스 (사전 **major** / 봇 **P1**) → **테스트 필수** (해당 경계 값·조건 커버)
- 보안/데이터손실/크래시 (사전 **critical** / 봇 **P0**) → **테스트 필수** (재현 시나리오 명시)
- 그 외 (사전 **info** / 봇 **P2 이하**) → **불필요**

**작성 원칙**:
- 실제 버그 시나리오를 최소 재현하는 테스트 1건 (그 이상은 별도 이슈).
- 코멘트에 리뷰 링크 or 이슈 번호 참조 (예: `// 회귀: PR #169 Codex P0 (Wk4 window off-by-one)`) — 봇 표기(P0/P1) 그대로 적는다.
- 테스트 프레임워크 부재 시 최소한 재현 스크립트 (`scripts/*.ts`) + `docs/specs/` 스펙 갱신으로 대체.

**예외**: UI 변경만·타이포·copy 수정 등 테스트로 잡기 어려운 수정 필수 등급은 스펙 문구 갱신 + `docs/designs/` 반영으로 대체.

#### 8-6. PR body 에 리뷰 결과 명시

PR body 에 **`## 코드 리뷰 결과` 섹션 필수**. 최소 포함:

- **리뷰 방식**: `에이전트 사전 리뷰 N회 + Codex bot M회` 또는 `self-review + Codex bot M회` (`only` 는 쓰지 않는다 — 결함 ⑥)
- **각 라운드 요약**: `1회차: major 2건 (내용), info 3건 → 반영`, `2회차: 0건 → 통과` 형식 (봇 라운드는 `P0`/`P1`/`P2` 표기 그대로)
- **최종 상태**: `✅ 사전 critical/major = 0/0 · 봇 P0/P1 = 0/0` — **0 을 요구하는 것은 이 넷뿐이다.** `info` / 봇 `P2` 이하는 **실제 건수와 처리**(후속 이슈 번호 또는 반영)를 적는다. 봇이 돌지 않았으면 봇 자리에 `봇: 미실행 (사유, YYYY-MM-DD)` (릴리즈 PR 은 대체 불가 — 8-3)
- **회귀 테스트**: 추가된 테스트 파일 목록 또는 "해당 없음 (UI 변경)"

이 섹션은 리뷰 사이클 감사·재발 추적·향후 스펙 갱신 근거로 활용.

#### 8-4. codex-cli MCP (선택 대안)

사전 리뷰의 대안으로 `mcp__codex-cli__codex` MCP 도구 사용 가능 (`codex exec` bash 호출 아님).

```
mcp__codex-cli__codex 호출:
- prompt: <8-1 프롬프트 그대로>
- reasoningEffort: "high"
- fullAuto: true
- workingDirectory: <repo path>
- resetSession: true
- model 파라미터는 생략 (기본 model 미지원 오류 시 지정 필요 - 예: "gpt-4o")
```

품질 유사하지만 model/quota 이슈 잦음. 실패 시 pr-review-toolkit 으로 폴백.

### 9. PR 생성
```bash
gh pr create --title "[Phase N] 기능명 (#<issue>)" --base dev --head feat/...
```

PR 본문에 포함:
- 변경 사항 요약
- `Closes #<issue-number>`
- 체크리스트: 린트/타입체크/테스트/빌드/리뷰 통과
- 코드 리뷰 결과: 리뷰 횟수, 사전 critical/major/info 건수 · 봇 P0/P1/P2 건수
- 디자인 반영 여부: `docs/designs/` 참조 링크 (UI 기능인 경우)

PR 링크를 사용자에게 알린다. **머지는 사용자가 직접.**

### 10. 머지 완료 후

사용자가 "머지 완료"를 알려주면:

```bash
# 1. 이슈에 완료 코멘트
gh issue comment <issue> --body "완료: PR #<pr>, 머지일 $(date +%Y-%m-%d)"

# 2. 이슈 종료
gh issue close <issue>

# 3. 브랜치 정리
git checkout dev && git pull && git branch -d feat/<issue>-...
```

4. `docs/roadmap.md` 해당 항목 체크 `- [x]`
5. 다음 작업이 있으면 사용자에게 제안.

## 긴급 수정 (Hotfix)

실서비스 버그 시 main에서 분기:
1. `git checkout main && git checkout -b hotfix/<issue>-<n>`
2. 수정 → 테스트 → **로컬 사전 리뷰 1회** (반복 루프만 생략. 게이트는 그대로 — **critical·major 는 반드시 수정**, info 는 후속 이슈)
3. PR 2개 생성: main 대상 + dev 대상 (양쪽 머지 원칙). 양쪽 body 에 **`## 코드 리뷰 결과` 섹션 + `봇: 리뷰 대기`** 를 넣는다 (8-6 · 템플릿은 `release-flow` Hotfix 절)
4. **봇 리뷰가 여기서 돈다** (8-2 는 PR 오픈 후에만 실행된다). 봇 **P0·P1** → 반드시 수정
   → **7단계 검증 재실행 + 8-5 회귀 테스트 → 통과해야 커밋** → 양쪽 PR 에 반영 → `@codex review` 로 재확인.
   **봇 P0/P1 = 0 이 될 때까지 머지하지 않는다.** 봇이 안 오면(쿼터 소진·장애) 8-3 봇 불가 표의 핫픽스 행 —
   2번 사전 리뷰 결과가 완료 판정이고 **사용자가 "봇 없이 머지" 를 명시 승인**해야 한다 (무한 대기도, 묵시 우회도 아니다)
5. 사용자가 양쪽 머지 → 이슈 종료

> **정정 (pleiades#8 결함 ③).** 이전 2번은 `수정 → 테스트 → 리뷰(1회, P2만)` 였다. 그 시점의 역방향 척도에서
> `P2` = critical 이므로 **로직·엣지케이스(major)를 건너뛸 수 있었고**, hotfix 는 곧장 실서비스로 가므로
> **알려진 기능 회귀를 배포**할 수 있는 경로였다. 줄이는 것은 **반복 횟수**이지 **수정 필수 등급**이 아니다.
> 또 봇 게이트를 둘 자리가 없었다 — 봇은 PR 오픈 전에는 돌지 않으므로(8-2) 4번으로 분리하고
> **머지를 봇 결과에 건다.**
