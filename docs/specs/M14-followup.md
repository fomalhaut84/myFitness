# M14 후속 백로그 (Phase 4 이후)

> 세션 간 컨텍스트 인계 문서. M14 Phase 2 ~ Phase 4 릴리즈 이후 발견/유예된 후속 작업 목록.
> 신규 세션 진입 시 이 문서로 진행 상황 파악 → 개별 이슈 착수.
>
> **⚠️ 모든 항목은 착수 시 재검증 필수**. 이 문서의 스코프·주의사항은 작성 시점 관찰 기반이라 코드 변경/API 진화에 따라 stale 될 수 있음. 항목 착수 전에 반드시 해당 파일·라인 확인 · Codex 지적의 근거가 여전히 유효한지 실코드로 재검증.

## 현재 상태 (2026-09-03, 식단 편집 · 보안 세션 종료 시점)

**최근 릴리즈:**
- **v2.26.1** — Phase 4 hotfix (Garmin naive-TZ 이슈 완전 해결)
- **v2.26.2** — 수면 SpO2 파싱 키 오타 수정 (#338) · 최저/최고 SpO2 저장
- **v2.27.0** — 야간 SpO2 그래프 (#342) · SpO2 표시 일관성 (#341)
- **v2.27.1** — 월간 SpO2 트렌드 차트 라벨 정정 (#346)
- **v2.27.2** — 식단 편집 force_reply 제거 · chat 단위 pending 전환 (#350)
- **v2.27.3** — npm audit 취약점 8건 해소 (#354) · 프롬프트 발송 실패 시 pending 잔존 (#357)
- **v2.27.4** — Security Audit 파서 fail-closed · Dependabot 자동 보안 PR 비활성화 (#359)

### 인계 (다음 세션에서 이어갈 것)

**오픈 PR · 오픈 이슈 0건.** main = dev = `v2.27.4`, 배포 성공 확인.

남은 것은 **실사용 확인 5건**. 전부 배포됐고 코드상 검증은 끝났으나 실기기 확인이 안 됨:

| # | 확인 | 릴리즈 | 실패 시 |
|---|---|---|---|
| 1 | **식단 수정 후 앱 재진입 시 답장 입력폼 미재생성** — 이번 세션의 최초 문제 | v2.27.2 | `food-edit-callback.ts` 에 force_reply 잔존 여부 확인 |
| 2 | 이미 폰에 박혀 있던 프롬프트 해소 여부 — `remove_keyboard` 는 best-effort (클라이언트 구현 의존). 안 사라지면 그 메시지를 직접 삭제 | v2.27.2 | 정상 (수정 대상 아님) |
| 3 | `[✕ 취소]` 동작 · pending 중 `/today` 가 명령으로 처리 · 비숫자 4회 입력 시 3회째까지 재프롬프트 후 종료 | v2.27.2~3 | `shouldConsumeAsEditInput` / `registerRetry` |
| 4 | AI 어드바이저 질문 1건 → MCP 도구 호출 정상 (`fast-uri` 3.1.5→3.1.7 영향) | v2.27.3 | ajv 스키마 검증. 로컬에선 `tools/list` 22개 정상 확인함 |
| 5 | Garmin 싱크 정상 (`qs` 6.15.2→6.16.0 영향) — 06:00 KST cron 또는 `/sync` | v2.27.3 | `@flow-js/garmin-connect` 쿼리 직렬화 |

추가 확인:
- **다음 월요일 03:00 UTC `Security Audit` 스케줄 실행** — 스케줄은 default branch 파일을 쓰므로 v2.27.4 로 비로소 새 파서가 적용됨
- **다음 `git push` 시 `GH007`** — 전역 git 이메일을 개인 Gmail 주소 (GitHub 계정에 등록됨) 로 바꿔서, "Block command line pushes that expose my email" 이 켜져 있으면 push 가 거부됨. 뜨면 그 설정을 끈다 — noreply 전환은 하지 않기로 결정했으므로 (개인 주소 노출은 수용, 회사 주소만 차단이 목표).

**로컬 잔여 브랜치 (이전 세션):** `chore/m6-roadmap`, `fix/203-3`, `fix/203-4`, `fix/220-1`, `fix/261-2`. 전부 dev 보다 한참 뒤처져 있음. `fix/261-2` 만 원격 없음. 정리 여부 미결정.

**이번 세션의 발견 (memory 반영됨):**
- **릴리즈 PR 은 merge commit 필수.** v2.27.2(#352)를 squash 한 탓에 main↔dev 공통 조상이 끊겨 다음 릴리즈 PR #356 이 3개 파일에서 충돌했다 (내용은 동일했는데도). main 을 dev 로 back-merge 해 복원. → memory `feedback_release_merge_commit`
- **`Closes #N` 은 default branch 머지에만 동작.** `dev` 로 가는 PR 은 이슈가 자동으로 닫히지 않으므로 수동 close 필요.
- **Dependabot 보안 PR 은 `target-branch` 로 못 옮긴다** — 항상 default branch 를 타겟. 게다가 커버리지가 자체 audit 의 부분집합이었다 (#353 이 4건, #355 가 6건). → #359 에서 자동 PR 비활성화, 알림은 유지.
- **커밋 이메일이 회사 주소로 노출돼 있었다.** 전역 git config 가 회사 주소였고 저장소가 public 이라 GitHub 공개 API 가 590 커밋의 이메일을 평문 서빙. OSS 파트너십 스팸의 유입 경로. GitHub 의 이메일 privacy 설정은 **계정에 등록된 주소만** 보호하므로 이 케이스엔 애초에 무력했다. 전역을 개인 Gmail 로, 회사 저장소 13개는 로컬 override 로 정리. **기존 590 커밋은 그대로 두기로 결정** (이력 재작성 비용 대비 실익 낮음, 포크·스타 0). → memory `project_commit_email_exposure`
    - **결론 (2026-09-04 사용자 결정)**: `users.noreply.github.com` 전환은 **하지 않는다**. 이 저장소는 public 이라 config 변경 이후 커밋도 개인 Gmail 이 commit metadata 에 평문으로 실리지만 (`/repos/.../commits/<sha>` 확인됨), 목표는 **회사 주소 비노출**이고 그건 달성됐다. 개인 주소 노출은 수용 범위.
    - **문서 규칙**: 이 저장소는 public 이므로 스펙·인계 문서에 실주소를 적지 않는다 (#362 Codex P1).

---

## 우선순위 A (사용자 요청 or 실사용 지장)

### A-1. Blood pressure fetcher 도 naive-TZ 이슈 검증
- **배경**: v2.26.1 body-composition hotfix 발견 시 사전 리뷰가 blood-pressure 도 같은 exclusive endDate + naive-TZ 이슈 가능성 언급. 사용자 관찰 표본 부족으로 미확정.
- **스코프**: `src/lib/garmin/fetchers/blood-pressure.ts` 의 endDate 처리 · entry timestamp 필드 관찰. inspect script 준비.
- **트리거**: 사용자가 혈압 측정한 오늘 값이 sync 후 DB 반영 안 됨을 관찰하면 즉시 착수.
- **참고**: v2.26.1 릴리즈 노트 §후속.

### A-2. 트렌드 · 도넛 · 근손실 위험 카드도 선택 날짜 기반 재계산
- **배경**: `/nutrition?date=X` 는 카드/리스트만 selected 날짜 · 트렌드/도넛/근손실 위험 (7일 aggregate) 은 오늘 기준 유지. 스코프 축소된 상태.
- **스코프**: `page.tsx` fetch (`aggregateRecentMacros`, `activities7d`, `latestBalances`) 에 selected 날짜 기준 옵션. 근손실 위험 assessor 도 재계산. UI 뷰 라벨 "최근 7일" → "선택 날짜 기준 7일" 로 조정.
- **주의 (Codex P2 재⁴재⁵지적, historical window)**: 현재 risk 계산 (`page.tsx:113-124`) 은 오늘 (incomplete day) 을 명시 제외하고 today-7..today-1 사용. Selected 가 과거 = 완료된 day 라 **selected 자체를 포함해야 함**. 하지만 오늘 조회 시 `selectedEnd = todayEnd = 다음 KST midnight` 이라 그대로 두면 오늘 (incomplete) 도 포함 → 기존 방어 뒤집힘. 조건부 window 필수:
    - `isToday` → `[todayStart - 7*DAY_MS, todayStart)` (기존 정책 유지 · 오늘 제외)
    - `!isToday` (historical) → `[selectedEnd - 7*DAY_MS, selectedEnd)` (selected 완료된 day 포함)
- **결정 필요**: 도넛 "오늘" 탭도 selected 날짜로 재라벨링 vs "선택 날짜" 로 아예 rename (C-2 와 함께).
- **주의 (사전 리뷰 지적)**: `latestWeight` (`page.tsx:82`) 는 지금 항상 `orderBy date desc` 최신 row 반환 → 과거 날짜 조회 시 미래/현재 weight 가 `protein-per-kg` 산출과 근손실 assessor 에 섞임. 이 스코프에 반드시 "선택 날짜 당일까지의 최신 weight" 조회로 교체 포함. **Predicate 는 exclusive upper `where: { date: { lt: selectedEnd } }` 사용** — `lte: selectedEnd` 는 selectedEnd (다음 KST midnight) 와 `startOfDay` 정규화된 다음 날 row 가 정확히 같은 instant 라 다음 날 measurement 포함하는 boundary leak (Codex P2 재재지적).
- **주의 (Codex P2 재지적)**: `todayLogsForDonut` (`page.tsx:178-192`) 는 v2.26.0 에서 도넛 "오늘" 뷰가 항상 실제 오늘 데이터로 남도록 하드코딩. A-2 스코프에 이 fetch 도 반드시 포함해 `selectedLogs` 재사용 (isToday 이면 그대로) 또는 selected day 범위로 재fetch 하도록 전환. C-2 (도넛 label date-aware) 만 하고 이 fetch 를 남기면 label 은 selected 인데 데이터는 오늘 → mismatch.

### A-3. Bot 명령으로 과거 식단 열람
- **배경**: `/nutrition?date=X` 는 웹 전용. 텔레그램 봇에서 과거 식단 조회 불가.
- **스코프**: `/food_show <date>` 또는 `/reports food <date>` 신설. inline keyboard 로 어제/그저께 등 shortcut. cuid 타이핑 요구 금지 (feedback_bot_mobile_ux 정합).

---

### A-6. 식단 편집 취소 버튼에 epoch/nonce 대조
- **배경**: `clearPendingEditFor` 는 logId 만 대조한다. 같은 로그를 편집 완료한 뒤 다시 편집을 시작하고, 스크롤을 올려 **예전 프롬프트의 `[✕ 취소]`** 를 누르면 진행 중인 새 편집이 취소된다.
- **스코프**: `food:edit-cancel:<logId>:<nonce>` 로 nonce 를 실어 대조. **아래 4가지를 한 덩어리로 처리해야 동작한다** (#362 Codex 리뷰 3라운드에 걸쳐 보강 — 원래 스코프는 1번만 적혀 있었고, 그대로 하면 모든 취소 버튼이 "알 수 없는 요청입니다" 로 떨어졌다):
    1. **상태·대조**: `markPendingEdit` 이 nonce 를 저장하고, 취소 콜백만 logId + nonce 를 함께 대조.
        - **삭제 cleanup 경로를 nonce 대조로 바꾸면 안 된다** (#362 Codex P2 재지적). `clearPendingEditFor` 호출부는 2곳인데 성격이 다르다: `:103` 은 사용자 취소 (nonce 있음 · 대조 필요), `:163` 은 삭제/P2025 cleanup 으로 **logId 밖에 없고 대상 로그가 사라진 게 확정된 경로**다. 후자까지 nonce 를 요구하면 삭제 후 pending 이 살아남아 다음 일반 메시지를 삭제된 로그의 입력으로 삼킨다 — PR #351 Codex P2 로 이미 한 번 고친 회귀다. **두 경로를 분리**할 것: `clearPendingEditFor(chatId, logId, nonce)` (취소 전용) + `clearPendingEditByLogId(chatId, logId)` (삭제 확정 전용, 무조건 정리).
    2. **파서**: `food-edit-callback.ts:48` 의 `parseCallbackData` 는 `parts.length !== 3` 이면 `null` 을 반환한다. 4-field 를 받도록 arity 를 풀고 (edit-cancel 만 4, 나머지 3 — 또는 `parts.length < 3` + optional 4번째), 반환 타입에 `nonce?: string` 추가. `auto-adjust-callback.ts` 의 동명 함수는 별개라 영향 없음.
    3. **발행 순서**: `armPendingEdit` (`food-edit-state.ts:136`) 은 `sendPrompt()` → `markPendingEdit` 순서다 (#357 fail-closed). 따라서 `markPendingEdit` 이 nonce 를 만들면 키보드 조립 시점에 값이 없다. **nonce 를 발송 전에 할당해 `sendPrompt` 에 넘기고, 저장은 발송 성공 후에** 하도록 리팩터 — #357 의 "발송 실패 시 pending 미잔존" 성질은 유지할 것.
    4. **재시도 프롬프트로 nonce 전달**: `buildCancelKeyboard` 호출부 3곳 (`food-edit-callback.ts:284,338,432`) 의 시그니처만 바꾸는 걸로는 부족하다 (#362 Codex P2 재지적). `:284` 는 신규 발행이라 방금 만든 nonce 를 쓰면 되지만, **`:338`·`:432` 는 재시도 경로**라 `peekPendingEdit` 이후에 실행된다. 그런데 `peekPendingEdit` (`food-edit-state.ts:103`) 은 `{ logId, action }` 만 반환한다 → 반환 타입에 `nonce` 를 추가해 **저장된 nonce 를 그대로 재사용**할 것. 새로 만들거나 `undefined` 로 두면 그 재시도 취소 버튼이 pending 과 불일치해 동작하지 않는다.
    - 64byte 한도: `food:edit-cancel:` 17 + cuid 25 + `:` 1 = 43 → nonce 에 21byte 여유. ms epoch(13) 은 안전하지만 짧은 random nonce 가 더 낫다 (같은 ms 재편집 충돌 회피).
- **우선순위 근거**: 실사용 확률 낮고 결과도 무해한 취소라 P0 로 분류됐다. 다만 pending 라우팅을 다시 손댈 때 함께 처리하면 저비용.
- **출처**: #350 사전 리뷰 P0, 스펙 `docs/specs/350-food-edit-force-reply-fix.md` §7.

---

## 우선순위 B (기능 확장)

### B-1. 식단 검색 (음식명 기준)
- **배경**: 날짜 조회는 되지만 "김치찌개 언제 먹었지?" 검색 불가.
- **스코프**: `/nutrition/search?q=김치찌개` or `/nutrition?q=` 파라미터. description 부분매치 + 최근 N일. 결과 리스트 → 클릭 시 해당 날짜 페이지.

### B-2. 캘린더 뷰 (월간 식단 개관)
- **배경**: 이전/다음 하루씩 이동만 있음. 특정 주 급 몰아보기 어려움.
- **스코프**: `/nutrition/calendar` 또는 현 페이지에 캘린더 컴포넌트 embed. 각 날짜 셀에 kcal 요약 · 클릭 시 그 날 상세. `MonthlyHeatmap` 재사용 검토.

### B-3. Items 개별 편집 · 삭제
- **배경**: v2.25.0 items breakdown 저장됐지만 편집은 항상 log 전체 재기록. 비빔밥/계란국 중 계란국만 삭제/정정 불가.
- **스코프**: `NutritionFoodList` 확장 카드 각 item 옆 편집/삭제 버튼. `PATCH /api/food/[id]/items` 신설. items 개별 write 시 top-level 재산출 정책 필요 (v2.25.0 스케일 로직 재활용).
- **주의 (Codex P2)**: top-level kcal 이 바뀌면 그 날의 `DailySummary.estimatedIntakeCalories` / `calorieBalance` 도 stale. 기존 whole-log PATCH (`src/app/api/food/[id]/route.ts:206-223`) 는 `recalculateCalorieBalance` 호출 + 실패 시 `markStaleRecalcDate` 로 큐잉. 새 items endpoint 도 동일 후처리 포함 필수.
- **주의 (Codex P2 재재재재지적, null propagation)**: `FoodItemBreakdown` 은 모든 numeric field (kcal/proteinG/carbsG/fatG) null 허용. items endpoint 가 top-level 재산출 시 field-by-field 정책 필요 (기존 `estimate-nutrition.ts` 정책과 정합):
    - 모든 items 의 필드가 non-null → `top[field] = sum` (0.1 단위 round).
    - 어느 item 이라도 필드 null → `top[field] = null` (부분 미측정 propagate).
    - Zero-summing null 은 undercount 유발이라 금지. 기존 값 유지도 stale 라 금지.
    - Top-level null 결과이면 backfill 큐에 재진입. **`nutritionAttempts` 는 리셋** (Round 18 Codex P2 재재재재재지적: `runFoodKcalBackfill` (`backfill.ts:58-74`) 는 kcal-present macro-partial 행에서 attempts >= MAX 이면 excluded. terminal 상태 row 는 사용자 편집으로 null 생겨도 재진입 못함. items 편집은 **user-induced new estimation context** 이므로 attempts 새로 부여 정당). 원래 spec 이 "이력 유지" 로 잘못 명시된 것 정정.
- **주의 (Codex P2 재지적)**: items 는 whole-array JSON write 라 concurrent item edit or backfill 과 race → silent overwrite. 기존 `applyKcalCorrection` 은 `FoodLog.updatedAt` snapshot (client 는 `expectedRevision` 전달) 로 409 conflict 반환. items endpoint 도 동일 conditional-update 계약 필요 (client 가 draft 편집 열 시점 updatedAt 전송 → server updateMany where updatedAt 매칭).
- **주의 (Codex P2 재재지적, backfill 쪽 race)**: endpoint 만 revision guard 해도 `backfill.ts:442-449` 의 update 는 description/mealType/kcal/macros 스냅샷만 사용해 `updatedAt` 미포함. 사용자 item rename or derived total 변경 없는 편집 시 stale backfill 이 endpoint 성공 후 덮어씀. **backfill update 절에도 `updatedAt` snapshot 매칭 추가** 필요.

### B-4. Estimator provenance 저장 + Items 별 source 표시
- **배경**: 현 `FoodLog` 스키마에는 source 필드가 **없음** (사전 리뷰 지적). estimator notes 는 응답으로만 전송되고 저장 안 됨. 개별 item 이 어느 source 에서 왔는지 알 수 없음.
- **스코프**:
  1. **Schema 확장** (Codex P2 재³재지적: repeat semantic 은 log 단위):
     - **Item 단위** (`FoodItemBreakdown` JSON): `source: "mfds" | "ai" | "vision" | "manual" | null` — 원본 estimator. `manual` = 사용자가 B-3 items 편집으로 name/값을 직접 정정한 경우 (Codex P2 재⁵지적). null = legacy fallback.
     - **Log 단위** (`FoodLog` 신규 컬럼): `repeatComponents: String[] @default([])` (Postgres text array) — repeat-lookup 에서 재사용된 component 를 명시 저장 (예: `["kcal"]`, `["kcal","macros"]`, `["items"]`, `[]`). Round 12 지적 (backfill 이 어떤 component 대체했는지 track 해야 정확한 badge 판정) 대응. items null legacy source row 도 log-level 컬럼이라 저장 가능. Prisma migration 필요 (`ALTER TABLE "FoodLog" ADD COLUMN "repeatComponents" TEXT[] NOT NULL DEFAULT '{}'::TEXT[]`).
     - `viaRepeat` 는 **derived** — DB 컬럼 아니라 `repeatComponents.length > 0` 로 read-time 계산 (server 응답 shape 에 편의 필드). Persistent 상태는 `repeatComponents` 하나만.
     - 예: MFDS 로 처음 계산 + 오늘 재기록 = `items[i].source="mfds"`, `log.repeatComponents=["kcal","macros","items"]`, UI 는 viaRepeat=true (derived) → "재사용" 뱃지.
     - `source` 를 "repeat" 로 세팅하면 원본 estimator 정보 loss + repeat 뱃지 unreachable 방지.
  2. **Write 경로 7곳 propagate** — 모두 `repeatComponents: string[]` 배열을 add/remove 로 관리 (Round 15 Codex P2 재¹¹지적: 스키마 fix 후 viaRepeat 컬럼 없으므로 "viaRepeat=true/false" 세팅 문구는 정합 안 됨):
     - **Creation paths** (`POST /api/food` JSON + photo, `bot/food.ts`, `bot/food-photo.ts`): 각 estimator 결과에 items[i].source 태그 (mfds/ai/vision). Repeat hit 채택 시 채택된 component 를 `repeatComponents` 에 append (예: kcal 만 재사용 = `["kcal"]`, kcal + macros + items 재사용 = `["kcal","macros","items"]`). Hit 발생만으로 append X, 실제 채택 (rejected partial 은 미채택).
     - **Backfill** (`backfill.ts`): repeat hit 이 새로 채택되면 add. 반대로 MFDS/AI 로 replace 한 component 는 `repeatComponents` 에서 remove (예: MFDS 가 macros/items 만 replace 시 `remove(["macros","items"])`). kcal 은 backfill 이 그대로 두므로 `"kcal"` 는 유지 → badge 유지.
     - **applyKcalCorrection** (3 callers: PATCH `/api/food/[id]`, bot `/food_kcal`, bot reply): kcal 이 사용자 값으로 대체 + top-level macros rescale + items rescale → `repeatComponents.remove(["kcal","macros","items"])` (Codex P2 재¹²지적: rescaled top-level macros 도 사용자 파생이라 macros 제거 필수). rescaled items 는 `source="manual"` 로 write. Helper 갱신 필요.
     - **Replacement paths** (`PATCH /api/food/[id]` description/mealType 변경, `bot/food-edit-callback.ts:364-376`): kcal/macros/items/attempts 리셋 시 `repeatComponents = []` (컨텍스트 완전 갱신).
     - **kcal blanking** (`PATCH /api/food/[id]` `estimatedKcal:null` branch, `route.ts:123-129`): kcal/macros/items/attempts 클리어 시 `repeatComponents = []`.
     - **Manual item edit** (B-3 items endpoint): 사용자가 정정한 items 는 `source="manual"`. items 편집 시 top-level kcal/macros 도 rederive → `repeatComponents.remove(["kcal","macros","items"])` (Codex P2 재¹³지적: per-item lineage 는 component-level flag 로 정확히 판정 불가 — 예: original source="manual" (legacy/이전 편집) item 이 B-3 로 재편집된 것과 여전히 reused 상태를 구별 못함. Coarser atomic policy 로 items endpoint 진입 시 무조건 `"items"` 제거. 편집 대상이 아닌 reused item 이 남아도 endpoint 세션 자체가 items 컨텍스트를 "manual override" 로 바꾸므로 semantics 일관).
  3. **Helper 확장 (Codex P2 재지적)**: `src/lib/nutrition/food-items.ts` 의 `sanitizeFoodItemBreakdown` 과 `scaleItemsForNewKcal` 이 지금은 5 known field (name/kcal/P/C/F) 만 map/reconstruct — 그대로 두면 repeat lookup sanitize · hit.kcal 스케일 · backfill retained kcal 스케일 모두에서 source 필드 loss. 두 helper 도 source passthrough 로 수정 필요 (source 미제공/null 이면 그대로 통과, invalid enum 값이면 null 로 normalize).
  4. **UI 확장**: `NutritionFoodList` items breakdown 각 row 에 source 배지 (MFDS: 파랑, AI: 노랑, Vision: 초록, Manual: 주황, **null / 미제공: "출처 미상" 회색 뱃지**). legacy row (source null) 도 breakdown 자체는 정상 표시. 카드 헤더 (log 단위) 에 `log.repeatComponents.length > 0` (= derived viaRepeat true) 이면 "재사용" 배지 별도 노출.
  5. **회귀 테스트**: `scripts/test-food-items-sanitize.ts` 에 source 보존 · null 통과 · invalid normalize 케이스 추가. legacy shape (source 필드 자체 없음) 이 sanitize 통과 검증.
- **주의**: 스키마 · write path · helper · UI · 테스트 5단 변경. 우선순위 B 유지하되 스코프 큼. legacy row 하위호환 정책 (source optional + null fallback) 이 스코프 확정의 핵심.

### B-5. MCP `weight-loss` items 노출
- **배경**: v2.25.0 items 저장했지만 MCP tool 응답에는 총합만 들어감. AI 어드바이저가 세부 조언 불가.
- **스코프**: `src/mcp/tools/weight-loss.ts` payload 에 items[] 추가. Prompt injection 방어 (name 필드 필터).

---

## 우선순위 C (UX 개선)

### C-1. 주간 러닝 목표 미달 알림
- **배경**: v2.25.0 "이번 주 X km / 목표 Y km" 진행률 표시. 미달 시 사용자 알림 없음.
- **스코프**: 주간 리포트 (월요일 07:00 KST, `src/bot/notifications/scheduler.ts:90-98`) 에 "지난 주 목표 미달 N km" 문구 추가. `weekly-report.ts` + `personal-goals.ts` 로직 확장.
- **주의 (Codex P2)**: 현재 `computePersonalGoals` 는 `currentWeekKm(now)` (이번 주 = 월요일 07:00 이면 0) + `completedWeeksAvgKm(4)` (4주 avg) 만 노출. 지난 주 정확한 shortfall 을 뽑으려면 `previousCompletedWeekKm()` 신규 헬퍼 필요 (`weekStartKST(1, now) ~ startOfWeekKST(now)` 러닝 총합). `PersonalGoalsProgress.targetWeeklyKm` shape 에 `lastWeekKm` 필드 추가.
- **주의 (Codex P2 재재재지적)**: shape 확장만으로는 리포트 prompt 노출 안 됨. 리포트 pipeline: `askAdvisor` → `buildDynamicContext()` → `formatGoalsForPrompt` (`src/lib/personal-goals.ts`) 가 현재 currentWeek + 4주 avg 만 emit. **`formatGoalsForPrompt` 도 lastWeekKm 문구 추가 필수** (또는 리포트가 `get_personal_goals` MCP tool 를 명시 호출해서 raw shape 참조). 어느 쪽이든 스코프에 명시.
- **주의 (Codex P2 재재지적)**: `completedWeeksAvgKm` 은 empty 결과에 null 반환. `previousCompletedWeekKm()` 이 같은 관례 따르면 사용자가 지난 주 0km 뛰었을 때 alert 발동 안 됨 → 최대 미달을 놓침. **empty week = `0` 반환** 명시적 contract. 리포트 로직도 lastWeekKm===0 case 를 "완전 미달 (0/{target} km)" 로 처리.

### C-2. 도넛 카드 "선택 날짜" 인지 개선
- **배경**: v2.26.0 도넛 "오늘" 뷰 하드코딩. 사용자가 과거 조회 시 도넛 label "오늘" 이 헷갈릴 수 있음 (뒤늦게 사전 리뷰에서 발견).
- **스코프**: A-2 와 함께 처리. 도넛 "오늘 · 2026-08-27" 스타일 label. 선택 날짜와 도넛 기준 date 를 명확히 병기.

### C-3. Lifestyle 페이지 직접 진입도 date-aware
- **배경**: v2.26.0 lifestyle 은 `?date=` 지원하지만 이 페이지 자체엔 date nav 없음. 사용자가 lifestyle 진입 후 다른 날짜 편집하려면 URL 수동 편집 or nutrition 페이지 우회.
- **스코프**: `TodayFoodSection` 헤더 옆에도 nav (또는 `NutritionDateNav` 재사용). 스코프 좁게: nutrition 링크가 primary entrypoint 로 유지될지 사용자 판단 필요.
- **주의 (Codex P2)**: `NutritionDateNav.navigateTo` 는 `/nutrition` pathname 하드코딩. lifestyle 페이지에서 재사용하면 매 클릭마다 lifestyle 벗어남 → 목적 실패. 재사용 접근 시 `basePath` prop (또는 `usePathname()` 기반 route-neutral) 로 리팩터 필요. 별도 컴포넌트 신설 (`DateNav` shared) 도 대안.

---

## 우선순위 D (기술 부채 · infra)

### D-1. Inspect script 세션 토큰 부작용
- **배경**: `scripts/inspect-garmin-weight.ts` 가 `getGarminClient()` 대신 fresh `new GarminConnect()` 사용 → 서버 측 토큰 rotation 가능성 (실제로는 auto-recovery 있어 문제 없었음). 사전 리뷰 관찰사항.
- **스코프**: `getGarminClient()` 재사용 or 실행 후 `client.exportTokenToFile(TOKEN_DIR)` 호출.

### D-2. body-composition sync 로그 세부화
- **배경**: v2.26.1 진단 시 pm2 log 은 "synced: N" 만 있어 skip 이유 확인 불가. 재발 시 진단이 어려움.
- **스코프**: `body-composition.ts` 에 verbose flag or DEBUG env 시 entry 별 (skip/update/create) 로그 출력.

### D-4. Security Audit 실행 실패 시 이슈 자동 생성 (?)
- **배경**: v2.27.4 로 파서는 fail-closed 가 됐지만, audit **실행 실패**는 워크플로우 실패(빨간 X + 알림)로만 드러난다. 취약점 발견 시에만 이슈가 생성된다.
- **판단 보류 근거**: 이 워크플로우는 2026-07-27 부터 실패가 시작돼 09-03 수정까지 **약 5.5주간** 방치됐다 (08-10 1회만 성공, 마지막 연속 실패는 08-17~09-03 = 17일 · 스케줄 4회). 그 사이 이슈(#266)도 이미 생성돼 있었다. 알림 채널을 늘리는 것이 해법이 아니라는 뜻. 실효 있는 대안(텔레그램 알림 연동 등)을 먼저 정할 것.
- **스코프**: 정한다면 `security-audit.yml` 에 `if: failure()` github-script 스텝 추가, 또는 기존 봇 알림 파이프라인 재사용.
- **출처**: #359 스펙 §7.

### D-3. Formal test framework 도입 (?)
- **배경**: 현 프로젝트는 `scripts/test-*.ts` 관례. lint/typecheck/build 는 있지만 unit/integration test runner 없음. 회귀 테스트 발견 시마다 스크립트 신설.
- **스코프**: vitest or jest 도입. 기존 `scripts/test-*.ts` 를 test suite 로 migration. CI 통합.
- **주의**: 규모 큰 변경. 사용자 명시 요청 시 착수.

---

## 진행 상태 인계 규칙

- 각 항목 착수 시 `- **Status**: 진행중 (이슈 #N, 브랜치 브랜치명)` 추가
- 완료 시 `- **Status**: 완료 (릴리즈 vX.Y.Z)` + 항목 자체를 이 파일 아래쪽 "완료" 섹션으로 이동
- 사용자 요청 시 새 항목 추가 (우선순위 결정)

---

## 완료 (참고)

### A-4. SpO2 표시 일관성 정리 (#338 후속)

- **Status**: 완료 (릴리즈 v2.27.0, 이슈 #341, PR #343)

- **배경**: #338 사전 리뷰 P0 지적 2건. 이번 스코프에서 후속으로 분리.
- **스코프 1 (surface 불일치)**: `src/app/page.tsx:88` 대시보드가 `todaySleep?.avgSpO2 ?? todaySummary?.avgSpo2` 로 수면 SpO2 결측 시 **주간 SpO2 로 대체**한다. #338 에서 MCP `_context` 와 system prompt 는 "null 이면 미측정 — 주간값으로 대체 판단 금지" 로 정했으므로, 미측정 야간에 대시보드는 주간값을 · 모닝 리포트는 "측정 없음" 을 보여 같은 날짜에 두 surface 가 어긋난다. 폴백 제거 or 카드 label 을 `SpO2 (주간)` 으로 분기.
- **스코프 2 (중복 포맷)**: `평균% (최저 N%)` 포맷이 `src/bot/commands/sleep.ts` 와 `src/app/sleep/[date]/sleep-detail-client.tsx` 에 각각 구현됨. `src/lib/format.ts` 로 `fmtSpO2(avg, lowest)` 승격해 공용화 (상세 페이지의 `"측정없음"` 분기는 AI 프롬프트 전용이라 옵션 인자로 분리).
- **주의**: 봇은 `src/bot/utils/formatter.ts` 를 쓰고 웹은 `src/lib/format.ts` 를 쓴다. 공용화 시 어느 쪽을 단일 소스로 삼을지 먼저 결정.

### A-5. 대시보드 월간 SpO2 트렌드 차트 라벨 (#341 후속)

- **Status**: 진행중 (이슈 #346, 브랜치 fix/346-1)

- **배경**: #341 사전 리뷰 참고 지적. 요약 카드는 `SpO2` / `SpO2 (주간)` 로 출처를 밝히게 됐는데, 같은 화면의 월간 트렌드 차트 (`src/app/dashboard-client.tsx:301-307`) 는 데이터가 100% `DailySummary.avgSpo2` (주간 측정) 인데 제목이 그냥 `SpO2` 다. 같은 화면에서 동일 라벨이 다른 측정 종류를 가리킨다.
- **스코프**: 트렌드 차트 제목을 `SpO2 (주간)` 으로 변경, 또는 `SleepRecord.avgSpO2` 시리즈로 교체/병기. 후자는 데이터 소스 변경이라 스코프가 커짐 — 먼저 라벨만 정정하는 쪽 권장.
- **주의**: v2.26.2 이전 기간은 `SleepRecord.avgSpO2` 가 전 기간 null 이었다. 백필 실행 여부에 따라 수면 시리즈로 교체 시 과거 구간이 비어 보일 수 있음.

### (백로그 외) 수면 SpO2 파싱 키 오타
- **Status**: 완료 (릴리즈 v2.26.2, 이슈 #338, PR #339)
- 실사용 제보로 발견 — 모닝 리포트가 매번 "SpO2 측정값 없음(null)". `dailySleepDTO.averageSpo2` 라는 존재하지 않는 키를 읽어 전 기간 NULL. 실제 키는 `averageSpO2Value`. 백필 스크립트에도 동일 오타가 있어 백필로도 복구 불가했음. `rawData` 보존 덕에 재싱크 없이 전 기간 복구.

### (백로그 외) 야간 SpO2 그래프
- **Status**: 완료 (릴리즈 v2.27.0, 이슈 #342, PR #343 · #345)
- `rawData.wellnessEpochSPO2DataDTOList` (야간당 260~463 포인트) 를 시계열 차트로. 스키마 변경 · 재싱크 없음.
