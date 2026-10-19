# [feat] 프롬프트 관리 — 버전 이력 · 편집 · 결과 연결 · AI 개선안 · 시험 실행

- **작성일**: 2026-10-19
- **타입**: feat
- **이슈**: #552
- **마일스톤**: M19 프롬프트 관리 — 3단계 (M19-1 · M19-2 · M19-3, 단계별 PR · 브랜치 `feat/552-1` ~ `feat/552-3`)
- **개인정보**: 프롬프트 본문은 이미 public 코드에 있다. 개인 목표 · 건강 수치는 런타임에 프로필 · 목표 섹션으로 주입되며 본문에 없다. AI 개선안 입력으로 쓰는 **리포트 결과 (건강 데이터)** 는 DB 에만 — 문서 · 이슈 · fixture · 커밋에는 가상 값만.

## 1. 배경

AI 분석 프롬프트가 전부 TS 상수 · 빌더에 하드코딩돼 있다 (`system-prompt.ts` `BASE_PROMPT` · `report-prompts.ts` · `activity-eval/build-context.ts`). 문구 하나 바꾸려면 코드 수정 → 릴리즈가 필요하고, 결과 (`AIAdvice`) 에는 **어떤 프롬프트로 만들었는지가 남지 않아** 변경 효과를 비교할 수 없다 (`AIAdvice.prompt` 는 사용자 턴만 저장).

## 2. 결정 (2026-10-19 사용자 승인)

1. **범위 = 어드바이저 계열**: 공통 시스템 프롬프트 · 모닝 · 이브닝 · 주간 리포트 · 운동 평가. 음식 추정 (텍스트 · 사진) · 검진 결과지 추출은 JSON 스키마 파싱이라 **제외** (코드 유지).
2. **템플릿 = 프롬프트 버전 자체** — 키마다 버전을 쌓고 활성 버전 하나를 쓴다. 재사용 블록 · 채팅 프리셋 관리는 제외.
3. **추천 = AI 개선안 제안** — 현재 활성 버전 + 최근 결과를 Claude 가 보고 수정본을 제안, 수락하면 **초안** 버전. 활성화는 사용자가.
4. **시험 실행 포함** — 초안 버전으로 실제 생성, 리포트로 저장하지 않는다.
5. **코드 기본값 변경 시 새 버전 자동 추가** — 웹에서 고친 적 없으면 바로 활성화, 고친 적 있으면 초안 + 배지 (R2).
6. 단계: M19-1 저장 · 버전 · 편집 → M19-2 결과 연결 · 비교 → M19-3 AI 개선안 · 시험 실행. 스펙 1 · 이슈 1 · PR 3.

## 3. 프롬프트 키

| key | 현재 위치 | 편집 대상 | 변수 | 필수 문구 (현 vitest 단언 이관) |
|---|---|---|---|---|
| `system` | `system-prompt.ts` `BASE_PROMPT` | BASE_PROMPT 만. 사용자 프로필 · HR 존 섹션 · 동적 컨텍스트 (현재 시각 · 개인 목표) 는 코드가 계속 붙인다 | 없음 | 없음 |
| `morning_report` | `report-prompts.ts` `MORNING_PROMPT` | 전체 | 없음 | `get_blood_pressure(days=7)` · `recommend_today_workout` |
| `evening_report` | `EVENING_PROMPT` | 전체 | 없음 | `get_activity_context(activityId)` · `get_personal_records()` |
| `weekly_report` | `buildWeeklyReportPrompt` | 전체 | `{{currentDays}}` · `{{baselineDays}}` · `{{baselineEndDate}}` (필수) | `get_activities(days={{currentDays}}, type="running")` · `endDate="{{baselineEndDate}}"` · `get_personal_records()` · `totals.weightedIntensityMinTotal` 등 현 테스트 목록 |
| `activity_eval` | `fullPrompt` (러닝) | 도입 · 출력 형식 지시. 데이터 섹션은 코드 조립 | `{{sections}}` · `{{sectionTitles}}` (필수) | 없음 |
| `activity_eval_brief` | `briefPrompt` (러닝 외) | 전체 | `{{sections}}` (필수) | 없음 |

정의는 `src/lib/prompts/definitions.ts` 한 곳 — key · 라벨 · 설명 · 코드 기본값 · 변수 (필수/허용) · 필수 문구 · 사용처 (화면 안내용).

## 4. 요구사항

### M19-1 · 저장 · 버전 · 편집

**스키마 (migration 1)**
- [ ] S1 `PromptVersion` — `id` · `key` · `version Int` · `body` · `note String?` (변경 메모) · `status` (`draft` · `active` · `archived`) · `source` (`code_default` · `manual` · `ai_suggestion` · `restore`) · `basedOnId String?` (편집 · 복원 · 제안의 출발 버전) · `codeHash String?` (`code_default` 만 — 기본값 본문 해시) · `createdAt` · `activatedAt DateTime?`. `@@unique([key, version])` · `@@index([key, status])`
- [ ] S2 migration 에 raw SQL — **키당 활성 1개** partial unique index (`WHERE status = 'active'`) · `status` · `source` · `key` CHECK 제약 (Prisma 미추적 — memory `project-source-check-constraints`)
- [ ] S3 버전은 **수정 · 삭제하지 않는다** (본문 불변). 바뀌는 건 `status` · `activatedAt` 뿐

**해석 (`src/lib/prompts/`)**
- [ ] R1 `resolvePrompt(key, vars)` → `{ text, versionId | null, fallback: boolean }`. 활성 버전 본문에 변수 치환. **DB 실패 · 활성 버전 없음 · 치환 실패 → 코드 기본값 + `console.warn`** (리포트가 멈추지 않는다)
- [ ] R2 `ensureDefaults()` — 키에 행이 없으면 코드 기본값을 v1 (`code_default` · `active`) 로 삽입. 코드 기본값이 최신 `code_default` 행의 `codeHash` 와 다르면 (**릴리즈로 코드 프롬프트가 바뀜** — 예: #547 처럼 도구 추가와 함께 시스템 프롬프트 수정) **새 `code_default` 버전을 자동 추가**한다 (2026-10-19 사용자 결정). DB 활성 버전이 새 코드 문구를 조용히 가려 새 도구 안내 등이 실서비스에 반영되지 않는 것을 막기 위함:
  - 현재 활성 버전이 **직전 `code_default`** (웹에서 고친 적 없음) → 새 버전을 **바로 활성화**. 코드로 고친 프롬프트가 지금처럼 릴리즈만으로 반영된다
  - 현재 활성 버전이 **웹에서 고친 버전** (`manual` · `ai_suggestion` · `restore`) → 사용자 수정을 덮어쓰지 않도록 새 버전을 **초안**으로 추가하고 목록 · 상세에 "코드 기본값 갱신 — 활성 버전에 반영 필요" 배지 + 활성 버전 대비 diff. 서버 로그 경고
  - **최신 코드 기본값으로 되돌린 버전** (`restore` · codeHash 승계) 은 "기본값 그대로" 로 본다 → 다음 갱신도 바로 사용. 더 옛 기본값으로 되돌린 건 사용자가 고른 문구라 초안 (사전 리뷰 info 5)
  - 갱신 초안이 있는 채로 다른 버전을 활성화하면 "코드 기본값 갱신" 경고는 사라지고 초안은 이력에 남는다 (의도 — 사용자가 활성 버전을 직접 정한 것)
  - 호출 시점: **프로세스 시작 시** (웹 · 봇 각각 — 첫 리포트 전에 반영) + 목록 API. idempotent · 동시 호출은 `(key, version)` unique 충돌을 무시하고 재조회
- [ ] R3 `validatePrompt(key, body)` → `{ errors, warnings }` — 오류: 필수 변수 누락 · 모르는 `{{변수}}` · 필수 문구 누락 · 빈 본문 · 길이 상한 (20,000자). 경고: 본문의 `mcp__myfitness__*` 중 어드바이저 allowlist 에 없는 도구. **저장 · 활성화 · 개선안 수락 모두 이 검증을 통과해야 한다**
- [ ] R4 `report-prompts.test.ts` 의 문구 단언을 정의의 필수 문구로 옮기고, 테스트는 "모든 코드 기본값이 `validatePrompt` 를 통과한다" + "필수 문구가 빠지면 오류" 로 바꾼다 (규칙 정본 하나)
- [ ] R5 기존 호출부 교체 — `daily-report.ts` · `weekly-report.ts` · `activities/[id]/evaluate` · `buildStaticSystemPrompt` 가 `resolvePrompt` 사용. 코드 상수는 기본값으로 남는다 (`definitions.ts` 로 이동, 기존 export 는 재노출)

**시스템 프롬프트 변경과 세션**
- [ ] R6 세션 저장소에 세션 생성 시점의 `system` 버전 ID 를 기록하고, `askAdvisor` 가 현재 활성 버전과 다르면 **새 세션**으로 시작한다. 웹 · 봇이 별도 PM2 프로세스라 활성화 시점에 메모리 세션을 직접 초기화할 수 없기 때문 — 다음 호출에서 각 프로세스가 스스로 감지

**API (`src/app/api/prompts/**` · try-catch · `{ error }`)**
- [ ] A1 `GET /api/prompts` — 키별 라벨 · 활성 버전 (번호 · 출처 · 활성화 시각) · 초안 수 · 코드 기본값 갱신 여부
- [ ] A2 `GET /api/prompts/[key]` — 정의 (변수 · 필수 문구 · 사용처) + 버전 목록 (본문 포함)
- [ ] A3 `POST /api/prompts/[key]/versions` `{ body, note?, basedOnId?, activate? }` — 검증 후 새 버전 (`manual`). `activate: true` 면 같은 트랜잭션에서 활성화
- [ ] A4 `POST /api/prompts/versions/[id]/activate` — 검증 재실행 → 기존 활성 → `archived`, 대상 → `active` (트랜잭션)
- [ ] A5 `POST /api/prompts/versions/[id]/restore` — 그 본문을 복사한 새 버전 (`restore` · `basedOnId`) 을 만들고 활성화. 옛 버전을 다시 활성화하지 않는다 (이력이 시간 순으로 읽히게)
- [ ] A6 `POST /api/prompts/validate` `{ key, body }` — 편집 중 실시간 검증 (저장 없음)

**화면 `/settings/prompts`**
- [ ] U1 목록 — 키별 카드: 라벨 · 사용처 (예: "모닝 리포트 · 매일 08:00 봇") · 활성 vN · 출처 배지 · 마지막 변경 · 초안 수 · "코드 기본값 갱신" 배지
- [ ] U2 상세 `/settings/prompts/[key]` — 편집기 (고정폭 · 변수 하이라이트 · 실시간 검증 결과) · 변경 메모 · "초안 저장" / "저장하고 활성화"
- [ ] U3 버전 이력 — 버전 · 상태 · 출처 · 메모 · 시각. 두 버전 선택 → **줄 단위 diff** (추가 녹색 · 삭제 빨강). 각 버전: 활성화 (초안) · 되돌리기 (보관)
- [ ] U4 `system` 상세에 경고 — "웹 채팅 · 텔레그램 · 리포트 · 운동 평가 전부에 바로 적용 · 진행 중인 대화는 다음 질문부터 새 세션"
- [ ] U5 설정 하위 탭 (프로필 · 프롬프트) — 사이드바 "설정" 은 그대로 `/settings/profile`
- [ ] U6 diff 는 순수 함수 (`src/lib/prompts/diff.ts` · 줄 단위 LCS) — 패키지 추가 없음 (프롬프트 수백 줄 이내)

### M19-2 · 결과 연결 · 비교

- [ ] L1 `AIAdvice` 에 `systemPromptVersionId String?` · `promptVersionId String?` (migration 1 · `PromptVersion` FK · `onDelete: SetNull`). 연결 이전 행은 null
- [ ] L2 `askAdvisor` 가 사용한 `system` 버전 ID 를 반환하고, 리포트 · 운동 평가 · 웹 채팅 저장부가 두 ID 를 기록 (채팅은 `system` 만). 폴백 (R1) 으로 코드 기본값을 쓴 경우 null
- [ ] L3 `GET /api/prompts/[key]/results?versionId=&limit=` — 그 키 카테고리의 `AIAdvice` (리포트 날짜 · 생성 시각 · 버전 · 응답). `system` 은 전 카테고리
- [ ] L4 상세 화면 "결과" 탭 — 버전 필터 · 결과 목록 (날짜 · 버전 배지 · 첫 줄) · 두 결과 **나란히 비교** (같은 카테고리 · 버전이 다른 결과 기본 추천). 버전 정보 없는 결과는 "버전 정보 없음"
- [ ] L5 버전 이력 각 행에 "결과 N건"

### M19-3 · AI 개선안 · 시험 실행

**개선안**
- [ ] G1 `POST /api/prompts/[key]/suggest` — 활성 버전 본문 + 정의 (변수 · 필수 문구 · 사용처) + 최근 결과 최대 5건 (L3 · 응답 각 4,000자 상한) 을 1회성 Claude 호출 (`--tools ""` · `--max-turns 1` · MCP 없음 — 음식 추정과 같은 방식) 에 넘겨 JSON `{ body, rationale: string[] }` 수신 → 파싱 · `validatePrompt` 검증 → 응답 (**저장하지 않음**)
- [ ] G2 화면 — "개선안 받기" → 진행 표시 → 근거 목록 + 활성 버전 대비 diff → **"초안으로 저장"** (`ai_suggestion` · `basedOnId` · 메모 = 근거 요약) 또는 버리기. 검증 오류가 있는 제안은 저장 불가 · 오류 표시
- [ ] G3 개선안 지시문 (메타 프롬프트) 은 코드 상수 — 관리 대상 아님

**시험 실행**
- [ ] T1 `PromptTrial` (migration) — `id` · `versionId` (FK) · `targetKind` (`report` · `activity`) · `targetRef` (리포트는 카테고리 · 활동은 activityId) · `status` (`running` · `done` · `failed`) · `response String?` · `errorMessage String?` · `startedAt` · `completedAt`
- [ ] T2 `POST /api/prompts/versions/[id]/trial` `{ activityId? }` — 백그라운드 실행 후 trialId 반환, `GET /api/prompts/trials/[id]` 폴링 (ReportJob 패턴). **동시 1건** (실행 중이면 409)
- [ ] T3 실행 — 리포트 키: **지금 시점 기준** 생성 (과거 날짜 재현은 동적 컨텍스트 · 도구가 현재 시각 기준이라 제외) · Garmin 사전 싱크 생략 · 전용 채널 `prompt-trial` 새 세션. `activity_eval*`: 지정 활동. `system` 초안: 고른 대상 (모닝 리포트 기본 · 또는 활동) 을 **그 초안 시스템 프롬프트로** 실행. `AIAdvice` 에 저장하지 않는다
- [ ] T4 화면 — 초안 버전 행의 "시험 실행" → 대상 선택 (활동 키: 최근 활동 목록) → 결과를 **같은 대상의 최근 실제 결과 (활성 버전)** 와 나란히. 시험 결과 목록은 버전별 보관
- [ ] T5 두 기능 모두 버튼을 눌렀을 때만 실행 (자동 실행 없음) · 버튼 옆에 "CLI 쿼터 사용 · 최대 3분" 안내

## 5. 기술 설계 요약

```
definitions.ts (키 · 기본값 · 규칙)
   ├─ validate.ts (R3) ── API 저장 · 활성화 · 개선안 · vitest
   ├─ render.ts  ({{var}} 치환 · 순수)
   └─ resolve.ts (R1 · R2 · prisma) ── daily/weekly-report · evaluate · system-prompt
diff.ts (순수) ── 화면
```

- 변수 문법 `{{name}}` — 본문의 다른 중괄호 (`{ ... }` JSON 예시) 와 겹치지 않게 이중 중괄호 · 영문 camelCase 만 변수로 인식.
- `resolve.ts` 는 prisma 의존이라 순수 모듈 (`definitions` · `validate` · `render` · `diff`) 과 파일 분리 (memory `project-next-rsc-boundary` — 클라이언트 편집기가 `validate` · `diff` 를 import 한다).
- Nginx: `/api/prompts` 는 기존 `/api` 프록시 경로 — 새 location 블록 불필요 (memory `project-nginx-location-trailing-slash`). 시험 실행 · 개선안은 백그라운드 + 폴링 / 1회 호출 (최대 60초) 이라 프록시 timeout 영향 없음 — 개선안이 60초를 넘으면 시험 실행과 같은 job 패턴으로 전환.

## 6. 변경 파일 (예상)

- M19-1: `prisma/schema.prisma` · `prisma/migrations/<ts>_prompt_version/` · `src/lib/prompts/{definitions,validate,render,diff,resolve}.ts` · `src/lib/report-prompts.ts` · `src/lib/ai/system-prompt.ts` · `src/lib/ai/session-store.ts` · `src/lib/ai/claude-advisor.ts` · `src/lib/daily-report.ts` · `src/lib/weekly-report.ts` · `src/lib/ai/activity-eval/build-context.ts` · `src/app/api/activities/[id]/evaluate/route.ts` · `src/app/api/prompts/**` · `src/app/settings/prompts/**` · `src/app/settings/profile/page.tsx` (탭) · 테스트
- M19-2: schema · migration · `claude-advisor.ts` · 리포트 · 평가 · `/api/ai` 저장부 · `api/prompts/[key]/results` · 상세 화면 결과 탭
- M19-3: schema · migration (`PromptTrial`) · `src/lib/prompts/{suggest,trial}.ts` · API · 화면

## 7. 테스트 계획 (vitest)

- M19-1: 코드 기본값 6개가 `validatePrompt` 통과 · 필수 문구/변수 누락 · 모르는 변수 · allowlist 밖 도구 경고 · `render` 치환 (중괄호 JSON 보존) · 주간 기본값 렌더 결과가 현 `buildWeeklyReportPrompt` 출력과 **동일** (회귀) · 운동 평가 렌더가 현 `fullPrompt` · `briefPrompt` 와 동일 · `diff` (추가 · 삭제 · 동일 · 빈 입력) · `resolve` 폴백 (DB 오류 · 활성 없음 → 기본값) · 세션 system 버전 불일치 → 새 세션 · `ensureDefaults` 해시 변경 → 활성이 직전 code_default 면 새 버전 활성화 · 웹 수정 버전이면 초안 추가 + 활성 유지 · 해시 같으면 무변화 (idempotent)
- M19-2: 저장부가 버전 ID 기록 · 폴백 시 null · 결과 조회 버전 필터
- M19-3: 개선안 응답 파싱 (JSON · 코드펜스 · 깨진 응답) · 검증 실패 제안 거부 · 시험 실행 동시 1건 · 실패 시 `failed` + 메시지
- 수동: 로컬에서 활성 버전 변경 → 운동 평가 1회 (DB 스냅샷 활동) · 리포트는 배포 후 cron 결과에서 버전 ID 확인

## 8. 제외 사항

- 음식 추정 · 검진 추출 프롬프트 · 개선안 메타 프롬프트 관리
- 재사용 블록 (공통 조각 끼워 넣기) · `/ai` 채팅 프리셋 웹 관리
- 모델 · max-turns · 허용 도구 목록 웹 설정 (코드 유지)
- 방향 지정 개선 ("더 짧게" 입력) — 필요 시 후속
- 과거 날짜 리포트 재현 시험 실행 · 활성/초안 동시 실행 비교 (쿼터 2배)
- 버전 삭제 · 프롬프트 키 추가/삭제 (정의는 코드)
