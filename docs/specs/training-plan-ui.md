# 트레이닝 플랜 UI 페이지

- **작성일**: 2026-07-01
- **타입**: feature (P1)
- **의존**: M6-1 (`generate_training_plan` / `get_active_training_plan`), M6-4 (`recommend_today_workout`)

## 1. 목적

M6 백엔드 도구를 웹 UI 로 노출. 사용자가 (1) 오늘 workout 을 확인 (2) 4주 플랜 진행률 파악 (3) 새 플랜 생성 (4) 과거 플랜 이력 조회를 웹에서 할 수 있게 함.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: `/training-plan` 페이지 신규
- [ ] **F2**: **오늘 workout 카드** (페이지 상단)
  - `recommend_today_workout` 결과 표시
  - base (계획된 workout) vs recommendation (조정 후) 비교
  - rationale (한국어 설명)
  - factors (readiness label/score, injury label/score)
  - pace range, zone, distance
  - 오늘 rest 인 경우 별도 표시 (예: "오늘은 회복일 — 완전 휴식 권장")
- [ ] **F3**: **Active plan 4주 캘린더** (페이지 중단)
  - 4주 × 요일 그리드
  - 각 셀: type + distance + pace (rest 는 흐리게)
  - 상태별 색상: completed (green) / missed (gray strike) / pending (default) / rest (dimmed)
  - 매칭된 activity 있으면 hover/tap 으로 실제 거리·페이스 표시
  - active plan 없으면 "플랜 없음" 상태 + 생성 CTA
- [ ] **F4**: **진행률 요약** (캘린더 하단 또는 사이드)
  - total / completed / missed / pending + completionPct 바 차트
- [ ] **F5**: **플랜 생성 폼** (모달 또는 별도 섹션)
  - weeklyFrequency (3~5 라디오, 기본 4)
  - targetDistance (선택 없음 | 5K | 10K | HM | FM)
  - targetDate (targetDistance 선택 시만 활성, Wk4 창 안내)
  - 제출 → `POST /api/training-plan/generate` → 응답 후 페이지 refetch
  - 기존 active plan 있으면 "덮어씀" 경고 확인
- [ ] **F6**: **Archived plan 이력** (하단 섹션)
  - 최신순 리스트: startDate ~ endDate + weeklyFrequency + targetDistance? + 완료율
  - 리스트 형태의 요약만 (클릭 상세 열람은 별도 후속 이슈)
- [ ] **F7**: 반응형 (모바일: 4주 캘린더 세로 스크롤 / 데스크톱: 4주 × 7일 그리드)
- [ ] **F8**: 다크 테마 기본

### 2.2 API 요구사항 (신규)

- [ ] **A1**: `GET /api/training-plan/active` — 현재 active plan + 진행. `getActiveTrainingPlan` 파싱해 반환.
- [ ] **A2**: `GET /api/training-plan/history` — archived plan 목록 (최신순 20개).
- [ ] **A3**: `GET /api/recommend-today` — `recommendTodayWorkout` 파싱해 반환.
- 기존: `POST /api/training-plan/generate` (M6-1 에서 완성됨)
- 제외: `GET /api/training-plan/[planId]` — archived 상세 뷰어는 별도 후속 이슈에서 추가.

### 2.3 비기능

- CSR/SSR 혼합. 초기 데이터는 서버 렌더링 (SSR fetch), 폼 제출 후 revalidate.
- 에러 처리: 각 fetch 실패 시 사용자 친화 메시지 + 재시도 버튼.
- 로딩 skeleton.
- 한국어 UI, 코드/변수는 영어.

## 3. 기술 설계

### 3.1 페이지 구조

```
src/app/training-plan/
  page.tsx                    # 서버 컴포넌트, 초기 데이터 fetch
  loading.tsx                 # skeleton
  error.tsx                   # 에러 페이지
  components/
    TodayWorkoutCard.tsx
    PlanCalendar.tsx
    ProgressBar.tsx
    GeneratePlanForm.tsx
    ArchivedPlansList.tsx
```

### 3.2 API routes 구조

```
src/app/api/training-plan/
  active/route.ts            # GET
  history/route.ts           # GET
  [planId]/route.ts          # GET (archived 상세)
  generate/route.ts          # POST (기존)
src/app/api/recommend-today/route.ts  # GET
```

### 3.3 데이터 흐름

```
page.tsx (server component)
  ├─ fetch GET /api/training-plan/active
  ├─ fetch GET /api/recommend-today
  ├─ fetch GET /api/training-plan/history
  └─ render 4 섹션

GeneratePlanForm.tsx (client component)
  ├─ POST /api/training-plan/generate
  └─ router.refresh()
```

### 3.4 디자인

**frontend-design 스킬 활용** (별도 단계 4). 프로토타입 승인 후 `docs/designs/training-plan-ui/` 에 저장.

## 4. 변경 파일

- `docs/specs/training-plan-ui.md` *(신규)*
- `docs/designs/training-plan-ui/` *(신규, 디자인 단계에서)*
- `src/app/training-plan/page.tsx` *(신규)*
- `src/app/training-plan/loading.tsx` *(신규)*
- `src/app/training-plan/error.tsx` *(신규)*
- `src/app/training-plan/components/*.tsx` *(신규)*
- `src/app/api/training-plan/active/route.ts` *(신규)*
- `src/app/api/training-plan/history/route.ts` *(신규)*
- `src/app/api/recommend-today/route.ts` *(신규)*
- `src/components/layout/Nav.tsx` — 네비 링크 추가 (필요 시)

## 5. 테스트 계획

`npm run lint && npm run typecheck && npm run test && npm run build` 4종.

수동 확인:
1. 페이지 로드 시 active plan / 오늘 workout / 이력 3개 섹션 표시
2. active plan 없을 때 "플랜 없음" + 생성 CTA
3. 폼 제출 → API 호출 → 페이지 refresh → 새 plan 표시
4. 모바일 반응형: 캘린더 세로 스크롤
5. 다크 테마 색상 정상

## 6. 제외 사항

- 개별 workout 수동 완료 표시 (진행은 자동 activity 매칭)
- workout 편집/삭제 (재생성으로만 변경)
- Push/이메일 알림
- 통계/차트 (진행률 바 외)
- Archived plan 상세 열람 뷰어 (`/api/training-plan/[planId]` 포함) — 후속 이슈

## 7. 롤백

`git revert`. DB / env 영향 없음 (읽기 전용 API + 새 페이지).
