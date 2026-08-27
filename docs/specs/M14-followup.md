# M14 후속 백로그 (Phase 4 이후)

> 세션 간 컨텍스트 인계 문서. M14 Phase 2 ~ Phase 4 릴리즈 이후 발견/유예된 후속 작업 목록.
> 신규 세션 진입 시 이 문서로 진행 상황 파악 → 개별 이슈 착수.

## 현재 상태 (2026-08-27)

**최근 릴리즈:**
- **v2.24.0** — Phase 2 완료 (MFDS 외부 음식 DB · 사진 입력 · 매크로 추적)
- **v2.25.0** — Phase 3 (주간 목표 Mon~Sun 마감 · 식단 items 세부 breakdown)
- **v2.26.0** — Phase 4 (체중 sync fix 초기 · 네비 "매크로"→"영양" · 식단 히스토리 조회)
- **v2.26.1** — Phase 4 hotfix (Garmin naive-TZ 이슈 완전 해결)

**중요한 발견 (memory):**
- Garmin `weight-service` API 의 `entry.date` 는 KST wall-clock 을 UTC 로 표기한 **naive-TZ** ms. 시각 비교 (미래/과거 필터) 에는 `entry.timestampGMT` 필수. `body-composition.ts` 는 v2.26.1 로 해결. 다른 fetcher (특히 `blood-pressure`) 도 같은 이슈 잠재.

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
- **결정 필요**: 도넛 "오늘" 탭도 selected 날짜로 재라벨링 vs "선택 날짜" 로 아예 rename.
- **주의 (사전 리뷰 지적)**: `latestWeight` (`page.tsx:82`) 는 지금 항상 `orderBy date desc` 최신 row 반환 → 과거 날짜 조회 시 미래/현재 weight 가 `protein-per-kg` 산출과 근손실 assessor 에 섞임. 이 스코프에 반드시 "선택 날짜 이전 최신 weight" (`where: { date: { lte: selectedEnd } }`) 조회로 교체 포함.

### A-3. Bot 명령으로 과거 식단 열람
- **배경**: `/nutrition?date=X` 는 웹 전용. 텔레그램 봇에서 과거 식단 조회 불가.
- **스코프**: `/food_show <date>` 또는 `/reports food <date>` 신설. inline keyboard 로 어제/그저께 등 shortcut. cuid 타이핑 요구 금지 (feedback_bot_mobile_ux 정합).

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

### B-4. Estimator provenance 저장 + Items 별 source 표시
- **배경**: 현 `FoodLog` 스키마에는 source 필드가 **없음** (사전 리뷰 지적). estimator notes 는 응답으로만 전송되고 저장 안 됨. 개별 item 이 어느 source 에서 왔는지 알 수 없음.
- **스코프**:
  1. **Schema 확장**: `FoodItemBreakdown` (JSON) 에 **optional** `source: "mfds" | "ai" | "vision" | "repeat" | null` 필드. `null` (legacy fallback) 도 명시적으로 sanitize 통과해야 v2.25.0 이후 저장된 기존 items breakdown 이 UI 에서 사라지지 않음. Prisma schema 는 nullable JSON 이라 별도 migration 없이 shape 확장 가능 (기존 row 자동 호환).
  2. **Write 경로 4곳 propagate**: `POST /api/food` (JSON + photo), `bot/food.ts`, `bot/food-photo.ts`, `backfill.ts` — 각 estimator 결과에 source 태그 붙여 저장. `repeat-lookup` hit 는 원본 source 를 그대로 전파.
  3. **Helper 확장 (Codex P2 재지적)**: `src/lib/nutrition/food-items.ts` 의 `sanitizeFoodItemBreakdown` 과 `scaleItemsForNewKcal` 이 지금은 5 known field (name/kcal/P/C/F) 만 map/reconstruct — 그대로 두면 repeat lookup sanitize · hit.kcal 스케일 · backfill retained kcal 스케일 모두에서 source 필드 loss. 두 helper 도 source passthrough 로 수정 필요 (source 미제공/null 이면 그대로 통과, invalid enum 값이면 null 로 normalize).
  4. **UI 확장**: `NutritionFoodList` items breakdown 각 row 에 source 배지 (MFDS: 파랑, AI: 노랑, Vision: 초록, Repeat: 회색, **null / 미제공: "출처 미상" 회색 뱃지**). legacy row (source null) 도 breakdown 자체는 정상 표시.
  5. **회귀 테스트**: `scripts/test-food-items-sanitize.ts` 에 source 보존 · null 통과 · invalid normalize 케이스 추가. legacy shape (source 필드 자체 없음) 이 sanitize 통과 검증.
- **주의**: 스키마 · write path · helper · UI · 테스트 5단 변경. 우선순위 B 유지하되 스코프 큼. legacy row 하위호환 정책 (source optional + null fallback) 이 스코프 확정의 핵심.

### B-5. MCP `weight-loss` items 노출
- **배경**: v2.25.0 items 저장했지만 MCP tool 응답에는 총합만 들어감. AI 어드바이저가 세부 조언 불가.
- **스코프**: `src/mcp/tools/weight-loss.ts` payload 에 items[] 추가. Prompt injection 방어 (name 필드 필터).

---

## 우선순위 C (UX 개선)

### C-1. 주간 러닝 목표 미달 알림
- **배경**: v2.25.0 "이번 주 X km / 목표 Y km" 진행률 표시. 미달 시 사용자 알림 없음.
- **스코프**: 주말 일요일 저녁 or 월요일 아침 리포트에 "지난 주 목표 미달 N km" 문구 추가. `weekly-report.ts` 로직 확장.

### C-2. 도넛 카드 "선택 날짜" 인지 개선
- **배경**: v2.26.0 도넛 "오늘" 뷰 하드코딩. 사용자가 과거 조회 시 도넛 label "오늘" 이 헷갈릴 수 있음 (뒤늦게 사전 리뷰에서 발견).
- **스코프**: A-2 와 함께 처리. 도넛 "오늘 · 2026-08-27" 스타일 label. 선택 날짜와 도넛 기준 date 를 명확히 병기.

### C-3. Lifestyle 페이지 직접 진입도 date-aware
- **배경**: v2.26.0 lifestyle 은 `?date=` 지원하지만 이 페이지 자체엔 date nav 없음. 사용자가 lifestyle 진입 후 다른 날짜 편집하려면 URL 수동 편집 or nutrition 페이지 우회.
- **스코프**: `TodayFoodSection` 헤더 옆에도 nav (또는 `NutritionDateNav` 재사용). 스코프 좁게: nutrition 링크가 primary entrypoint 로 유지될지 사용자 판단 필요.

---

## 우선순위 D (기술 부채 · infra)

### D-1. Inspect script 세션 토큰 부작용
- **배경**: `scripts/inspect-garmin-weight.ts` 가 `getGarminClient()` 대신 fresh `new GarminConnect()` 사용 → 서버 측 토큰 rotation 가능성 (실제로는 auto-recovery 있어 문제 없었음). 사전 리뷰 관찰사항.
- **스코프**: `getGarminClient()` 재사용 or 실행 후 `client.exportTokenToFile(TOKEN_DIR)` 호출.

### D-2. body-composition sync 로그 세부화
- **배경**: v2.26.1 진단 시 pm2 log 은 "synced: N" 만 있어 skip 이유 확인 불가. 재발 시 진단이 어려움.
- **스코프**: `body-composition.ts` 에 verbose flag or DEBUG env 시 entry 별 (skip/update/create) 로그 출력.

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

(현 시점 없음 — 릴리즈 완료 항목은 상단 "현재 상태" 참조)
