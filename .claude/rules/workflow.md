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

```bash
# 릴리즈 절차
git checkout main && git pull
git merge dev
git tag v1.0.0
git push origin main --tags

gh release create v1.0.0 --title "v1.0.0" --notes "릴리즈 노트 내용"
```

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
라벨: `phase-1`~`phase-N`, `feature`/`bug`/`chore`, `P0`/`P1`/`P2`

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

두 단계 리뷰. 목적: P1/P2 이슈를 걸러내되 재리뷰 사이클과 토큰 소비를 최소화.

#### 8-0. 적용 조건 (필수 vs self-review)

변경 규모·성격에 따라 사전 리뷰 강도를 조절.

| 변경 성격 | 사전 리뷰 (8-1) | 근거 |
|---|---|---|
| 애플리케이션 코드 (`src/**` 로직) | **에이전트 리뷰 필수** | 로직 버그·엣지케이스 커버 |
| DB 스키마/마이그레이션 | **에이전트 리뷰 필수** | 데이터 손실·정합성 위험 |
| API route / MCP 도구 신설·수정 | **에이전트 리뷰 필수** | 경계 계층 (보안·오남용) |
| Config / infra (`.github/**`, `tailwind.config.ts`, etc.) 소규모 | **self-review** (내가 diff 훑고 3-check) | 파급 국소 |
| 문서/스펙만 (`docs/**`, `*.md`) | **self-review** | 실행 코드 아님 |
| 디자인 시안 (`docs/designs/**`) | **self-review** | 실행 코드 아님 |

self-review 시에도 3-check (`lint / typecheck / build`) 필수, PR body 리뷰 결과 섹션에 "self-review only (변경 성격: <카테고리>)" 명시.

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
- P0 (info): 스타일·네이밍
- P1 (major): 로직·엣지케이스·성능
- P2 (critical): 보안·데이터손실·크래시

## Output
각 이슈: severity + file:line + 설명 + fix.
최종 counts: P0/P1/P2.
""")
```

**심각도별 대응 (사전 리뷰):**
- **P2**: 반드시 수정.
- **P1**: 반드시 수정.
- **P0**: 대체로 반영하되, 저비용/명확한 것만. 큰 리팩터를 요구하는 P0 는 후속 이슈로 분리.

P1/P2 반영 후 3-check (`lint / typecheck / build`) 재통과 → PR 오픈.

#### 8-2. Codex bot 자동 리뷰 (PR 오픈 후)

GitHub 이 PR 오픈 시 자동으로 Codex bot 리뷰 트리거. **매 커밋마다 재실행되지 않음** — 사용자가 `@codex review` 코멘트를 남길 때만 재리뷰.

**심각도별 대응 (Codex bot):**
- **P2**: 반드시 수정.
- **P1**: 반드시 수정.
- **P0**: 원칙적으로 무시 (후속 이슈로만 트래킹). 이유: 사전 리뷰에서 이미 P0 를 정리했고, Codex 재리뷰마다 GitHub 토큰이 새로 청구됨.

**재리뷰 절제:**
- P1/P2 를 실제로 반영한 커밋에 한해 `@codex review` 요청.
- P0 만 반영했거나 문서/스펙만 바꾼 경우엔 재리뷰 요청 금지.

#### 8-3. 반복 루프

```
사전 리뷰 (필수인 경우) → P1/P2 = 0 → PR 오픈
  ↓
Codex bot 리뷰 → P1/P2 있음? → Yes → 수정 → 커밋 → @codex review
                              → No  → ✅ 통과 (P0 는 무시)
```

최종 통과 시: "✅ 코드 리뷰 통과 (P1/P2: 0건)" 출력. **매 리뷰 결과는 사용자에게 요약 보고.**

#### 8-5. 회귀 방지 테스트 (P1/P2 반영 시)

봇/에이전트가 잡은 **P1/P2 를 수정할 때는 그 이슈를 노출하는 회귀 테스트를 함께 추가한다.** 목적: 같은 버그가 리팩터/변경으로 재발하지 않도록 CI 에서 계속 검증.

**추가 시점**:
- P1 → 로직/엣지케이스 → **테스트 필수** (해당 경계 값·조건 커버)
- P2 → 보안/데이터손실/크래시 → **테스트 필수** (재현 시나리오 명시)
- P0 → **불필요**

**작성 원칙**:
- 실제 버그 시나리오를 최소 재현하는 테스트 1건 (그 이상은 별도 이슈).
- 코멘트에 리뷰 링크 or 이슈 번호 참조 (예: `// 회귀: PR #169 Codex 리뷰 P2 (Wk4 window off-by-one)`).
- 테스트 프레임워크 부재 시 최소한 재현 스크립트 (`scripts/*.ts`) + `docs/specs/` 스펙 갱신으로 대체.

**예외**: UI 변경만·타이포·copy 수정 등 테스트로 잡기 어려운 P1/P2 는 스펙 문구 갱신 + `docs/designs/` 반영으로 대체.

#### 8-6. PR body 에 리뷰 결과 명시

PR body 에 **`## 코드 리뷰 결과` 섹션 필수**. 최소 포함:

- **리뷰 방식**: `에이전트 사전 리뷰 N회 + Codex bot M회` 또는 `self-review only (변경 성격: <카테고리>)`
- **각 라운드 요약**: `1회차: P1 2건 (내용), P0 3건 → 반영`, `2회차: 0건 → 통과` 형식
- **최종 상태**: `✅ P0/P1/P2 = 0/0/0`
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
- 코드 리뷰 결과: 리뷰 횟수, P0/P1/P2 건수
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
2. 수정 → 테스트 → 리뷰(1회, P2만)
3. PR 2개 생성: main 대상 + dev 대상 (양쪽 머지 원칙)
4. 사용자가 양쪽 머지 → 이슈 종료
