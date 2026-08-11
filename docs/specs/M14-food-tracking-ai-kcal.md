# [M14] 자체 음식 트래킹 + AI 기반 kcal 추정 (MyFitnessPal 대체)

- **작성일**: 2026-08-07
- **이슈**: [#283](https://github.com/fomalhaut84/myFitness/issues/283) (완료 · 2026-08-08)
- **구현 PR**: [#284](https://github.com/fomalhaut84/myFitness/pull/284), [#286](https://github.com/fomalhaut84/myFitness/pull/286) (Codex 리뷰 대응)
- **릴리즈**: **v2.19.0** (2026-08-09)
- **상태**: ✅ Phase 1 완료
- **선행**: M4-2 (칼로리 밸런스 계산), M4-3 (FoodLog + `/food` 봇 명령)
- **범위**: Phase 1 — 텔레그램 자유 텍스트 입력 → AI 로 kcal 자동 추정 → 저장 → 대시보드 자동 반영

## 배경

MyFitnessPal 을 이용 중이었으나 아래 이유로 이탈:
1. **한국 음식 DB 부족** — 집밥·한식·문화권 음식 검색 결과 부정확
2. **매번 밈(meal) 재작성** — 자주 먹는 것 재사용 UX 나쁨

현재 프로젝트의 `FoodLog` + `/food` 봇 명령은 이미 자체 구현이지만 `estimatedKcal = null` 로 저장 — 실제 kcal 추정을 아무도 안 함. 따라서 `DailySummary.estimatedIntakeCalories` 도 비어 있고 대시보드 "섭취" 카드가 사실상 무의미. **MFP 대체의 실질적 완성은 kcal 자동 추정 하나로 달성됨.**

Phase 2 이후 (자주 먹는 음식 라이브러리, 매크로 P/C/F, 외부 DB) 는 별도 이슈로 분리.

## 목표 (Phase 1) — 완료

- [x] 텔레그램 봇 `/food` 흐름에서 자유 텍스트 → Claude AI 로 kcal 추정 (한국 음식 특화 프롬프트)
- [x] `FoodLog.estimatedKcal` 자동 저장, 실패 시 null (기존 저장 흐름 유지)
- [x] `DailySummary.estimatedIntakeCalories` 재계산 — 미추정 log 존재 시 null 로 propagate (Codex 리뷰 P2 반영)
- [x] 봇 리플라이에 추정 kcal 노출 + 사용자 정정 명령 (`/food_kcal <id> <kcal>`)
- [x] 웹 lifestyle 페이지에 오늘 음식 로그 리스트 (kcal 편집 인라인)
- [x] AI 리포트 시스템 프롬프트에 "kcal 은 AI 추정치, ±30% 오차 가능" 명시
- [x] 실패/재시도 정책: `runFoodKcalBackfill` + cron 매 tick 자동 실행 + `npm run backfill:food-kcal` 수동 실행
- [x] Recalc 실패 회복 파이프라인: `stale-recalc` 큐 (SystemAlertState 재활용, claim-then-ack)

## 비목표 (Phase 2+ 로 분리)

- 자주 먹는 음식 라이브러리 (past FoodLog description 재사용, 유사도 매칭)
- P/C/F 매크로 분석, 단백질 목표 추적 (기존 스펙 `m4-8-nutrition-analysis.md`)
- 외부 음식 DB 연동 (오픈식약처 등)
- 사진 → Vision 분석
- 사용자별 즐겨찾기 밈

## 기술 설계

### 1) 스키마 변경

Phase 1 은 **스키마 변경 없음** (초기 목표대로 달성). `FoodLog` 기존 필드 (`description`, `estimatedKcal`, `mealType`, `date`) 를 그대로 사용.

Codex 리뷰 P2 (backfill starvation, cross-process 원자성) 대응을 위해 `SystemAlertState` 를 재활용해 신규 모델 도입 없이 처리:
- `alertType = "food_stale_recalc:YYYY-MM-DD"` — per-date row (upsert idempotent, deleteMany 조건부 ack)

### 2) AI kcal 추정 서비스 — 구현: `src/lib/nutrition/estimate-kcal.ts`

- Claude CLI (`claude -p`) single-shot 호출 (MCP·세션·retry 없음, 기존 `claude-advisor.ts` 는 heavy)
- **프롬프트 원칙**: 한국 음식·1인분 기본 가정. JSON 응답 강제. 모르는 항목은 `{ name, kcal: null }` 로 뱉게 함.
- 응답 timeout: **15초** (기본), `child.stdin.end()` 로 EOF 명시 (매 호출 timeout 대기 방지)
- 실패/timeout 시 null 반환. 상위 (봇/API) 는 log 저장 자체는 성공 유지.

**검증 (`parseKcalResponse`)** — Codex 리뷰 다수 P2 대응으로 계층화:

1. JSON 파싱 + non-object/null/array 방어 (uncaughtException 회피)
2. `total_kcal` sanity: `0 ≤ total ≤ MAX_KCAL_SANITY(5000)`
3. `items` 필수 (없거나 빈 배열이면 total 검증 불가 → reject)
4. `toItem` 에서 필터링된 malformed row 있으면 reject (raw count 비교)
5. 어느 item 이든 `kcal` 이 null 이면 total 은 부분 합계 → reject
6. Item 별 `kcal` 이 음수거나 `MAX_ITEM_KCAL(3000)` 초과면 reject
7. `Σ items.kcal ≈ total_kcal` (tolerance `max(30, 5%*total)`) — AI 내부 부정합 방어

### 3) 봇 흐름 — 구현: `src/bot/commands/food.ts`

`handleFoodInput`:
1. 정규식 매칭 → `mealType` 추출 (`아침/조식`, `점심/중식`, `저녁/석식`, `간식/야식`)
2. `FoodLog` 저장 (`estimatedKcal: null`, id 획득)
3. `ctx.replyWithChatAction("typing")` — AI 대기 중 시각적 피드백 (P1-3 반영)
4. **`await estimateKcalFromText`** — 15초 이내 응답 or null
5. AI 성공 시 조건부 `updateMany where { id, estimatedKcal: null, description, mealType }` — race 방어 (사용자 웹 정정, description PATCH 등 보존)
6. `recalcWithRetry(now, 1)` — 재계산 재시도 + 실패 시 `markStaleRecalcDate` 로 cron 파이프라인 위임
7. 응답에 추정 kcal + confidence + `/food_kcal <id> <kcal>` 정정 명령 안내

**`handleFoodKcalCommand`** — `/food_kcal <cuid> <kcal>` 정정 명령:
- 정규식: `/^\/food_kcal(?:@\S+)?\s+(\S+)\s+(\d{1,5})\s*$/`
- 값 검증: `0 ≤ kcal ≤ 10000`
- 성공 시 `recalcWithRetry` → 실패면 큐 mark + 사용자에게 명시 경고

**모바일 UX 이슈** (사용자 피드백 2026-08-09): cuid 타이핑 불편. Phase 2 후속 항목 1번으로 개선 예정.

### 4) 웹 UI — 구현: `src/app/lifestyle/lifestyle-client.tsx` `TodayFoodSection`

- 오늘 (KST 기준, `todayKST()` 사용) FoodLog 목록 표시
- 각 항목: 시각 (KST 명시), 식사 유형, description, kcal (없으면 "—"), 편집/삭제 버튼
- **인라인 kcal 편집**: `PATCH /api/food/{id}` — 정규식 `/^\d+$/` 로 정수 사전 검증 (parseInt 잘라먹기 방지)
- **합계 표시**: null 항목 있으면 "부분 합계 X kcal (N개 추정 대기)", 없으면 "총 X kcal"

### 5) API — 구현: `src/app/api/food/[id]/route.ts`

- **PATCH**: Zod 스키마 `{ estimatedKcal, description, mealType }` 부분 업데이트
  - description/mealType 변경 시 (kcal 미제공) 기존 kcal 을 null 로 자동 리셋 → backfill 재추정 (Codex P2 stale kcal 방지)
- **DELETE**: 로그 제거
- 두 경우 모두 `recalculateCalorieBalance` 실패 시 `markStaleRecalcDate` 로 큐 mark
- Prisma `P2025` → 404 (typed 검사)

`src/app/api/food/route.ts` POST 도 키워드 기반 `estimateCalories` → `estimateKcalFromText` 로 교체.

### 6) Backfill 파이프라인 — 구현: `src/lib/nutrition/backfill.ts`

`runFoodKcalBackfill(opts)`:
- **cron 모드** (`limit` 지정): Postgres `ORDER BY random() LIMIT N` raw query — 전체 null pool 에서 균등 sampling, permanent-fail 이 특정 window 를 점유해도 다른 row 순환 진입 (#286)
- **전량 모드** (`limit` 미지정): cursor-based (id asc) 페이지네이션으로 모든 null row 순회
- `createdAt < now - 60s` 조건: 봇의 첫 AI 호출과 race 회피
- 성공 시 조건부 update (id + description + mealType 스냅샷) — race 방어
- 최종 recalc 실패 date 는 `markStaleRecalcDate` 로 큐 mark

호출 경로:
- `scripts/backfill-food-kcal.ts` (수동, `npm run backfill:food-kcal`)
- `src/lib/cron.ts` 매 Garmin sync tick 후 자동 실행 (`limit: 20`) + stale-recalc 큐 처리

### 7) Stale-recalc 큐 — 구현: `src/lib/nutrition/stale-recalc.ts`

Recalculate 가 transient 실패한 date 를 보존해 cron 이 이어받게 하는 회복 파이프라인.

- 스키마 신규 모델 없이 `SystemAlertState` per-date row 재활용:
  - `alertType = "food_stale_recalc:YYYY-MM-DD"` (KST 기준, `ymdKST()` 정규화)
  - `markStaleRecalcDate` — upsert (idempotent)
  - `listStaleRecalcDates` — `startsWith` 조회 + `lastAlertAt` 반환 (claim)
  - `ackStaleRecalcClaim` — `deleteMany where lastAlertAt <= claimedAt` (claim 이후 새 mark 는 보존)
- Producer: `bot/food handleFoodInput`, `/food_kcal`, `api/food/[id]` PATCH/DELETE, `runFoodKcalBackfill`
- Consumer: `src/lib/cron.ts` 매 tick — list → recalc → 성공만 ack, 실패 date 는 큐 유지 (프로세스 중단 시에도 소실 없음)

### 8) AI 리포트 반영 — 구현: `src/lib/ai/system-prompt.ts`

`## 칼로리 밸런스 해석` 섹션에 추가:
```
- estimatedIntakeCalories 는 사용자가 텔레그램/웹에 자유 텍스트로 입력한 음식을 AI 가 추정한
  값 (M14 Phase 1). ±30% 오차 가능. 절대값보다 하루/주간 추세, 결손 방향으로 판단. 사용자가
  웹에서 수동 정정한 값은 상대적으로 더 신뢰.
```

## 테스트 계획

**Note**: 프로젝트에 unit test 프레임워크가 없어 자동 테스트 미작성. 대신 다음으로 검증:

- **정적**: `lint / typecheck / build` 통과
- **사전 리뷰**: pr-review-toolkit code-reviewer 로 P1/P2 검토
- **AI 리뷰**: Codex bot 15+ 라운드 반영 (P1 → P2 → P2 순차 심화)
- **로컬 실행**: dev 로컬 DB 에서 봇/웹 흐름 스팟체크
- **배포 후 검증**:
  - 텔레그램 "점심 김치찌개 밥" → 15초 내 kcal 응답
  - 대시보드 "섭취" 카드에 값 표시
  - 웹 lifestyle "오늘 음식" 섹션 노출
  - 다음 날 아침 리포트에 전날 섭취 언급

## 배포 노트

- DB 마이그레이션 없음 (Phase 1)
- Claude CLI 이미 설치·인증 완료 상태 가정
- 배포 스크립트: `deploy.sh` 의 `npm ci && npm run build && pm2 restart` 로 자동
- **선택 조치**: `npm run backfill:food-kcal` — 릴리즈 전 kcal null 이던 과거 log 를 즉시 채움. 안 돌려도 cron 이 매 sync tick 마다 자동으로 최대 20건씩 처리
- 롤백: 봇 코드 revert 시 기존 흐름 (kcal null 저장) 복귀. 이미 저장된 kcal 값은 남음 (안전).

## Codex 리뷰 반영 요약 (P1/P2 만)

15+ 라운드에 걸친 리뷰 대응. 주요 카테고리:

- **정합성**: stale kcal 저장 방지 (description/mealType 스냅샷 조건부 update, 프롬프트 입력 변경 시 kcal 자동 null 리셋)
- **원자성/race**: cross-process backfill lock, stale-recalc claim-then-ack, 조건부 updateMany
- **회복**: transient AI 실패 재추정 파이프라인, recalc 실패 큐 (cron 이어받음), backfill random-sample rotation
- **검증**: AI 응답 계층 검증 (JSON→object→items→kcal null→per-item range→sum-total 정합)
- **시각/TZ**: KST 정규화 (`ymdKST`, `todayKST`), UI 시각 `timeZone: "Asia/Seoul"` 고정
- **사용성**: null kcal 항목 "추정 실패 · 재시도 예정" 표시, 부분 합계 라벨, typing indicator

## 후속 (Phase 2 로 별도 이슈)

1. **봇 정정 UX 모바일 개선** — 사용자 피드백 (2026-08-09): `/food_kcal <cuid> <kcal>` 형식이 모바일에서 cuid 타이핑 불편. 대안 (우선순위 순):
   1. Telegram reply-to — 봇 kcal 응답 메시지에 사용자 reply → `/food_kcal 400` 만 (id 는 원본 메시지에서 추출)
   2. Inline keyboard "수정" 버튼 → callback_query 로 처리 (id 는 `callback_data` 에 embed)
   3. 최근 N 분 이내 마지막 log 를 default 로 (`/food_kcal 400` 만 입력)
   4. 웹 UI 로만 편집 유도 (lifestyle 페이지 인라인 편집이 이미 있음, 봇 명령 제거 안내)
2. ~~**자주 먹는 음식 라이브러리**~~ ✅ #295 완료 (PR #296, 2026-08-11) — 최근 30일 pool 을 in-memory 정규화 (phrase 분할 + qty-그룹 sort + modifier 결합 보존) 로 매칭. 봇/웹 POST/backfill 모두 target 시각 기준 preceding 창.
3. **P/C/F 매크로** — 기존 `m4-8-nutrition-analysis.md` 스펙 부활
4. **외부 음식 DB** — 오픈식약처, 만개의 레시피 API 등
5. **사진 입력** — Claude Vision 으로 사진 → 항목 추출 → kcal
6. **재추정 backfill** — weather backfill 패턴 재활용 (이미 v2.19.0 에 구현 — 재추정은 cron 자동 처리)

## 관련 메모리

- `feedback_bot_mobile_ux` — 봇 명령에서 cuid 등 긴 식별자 입력 요구 금지
- `feedback_release_via_pr` — 릴리즈는 dev→main PR + 사용자 머지
- `feedback_review_policy` — 사전 pr-review-toolkit 1회 + Codex bot 만
