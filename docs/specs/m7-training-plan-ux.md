# M7: 트레이닝 플랜 UX 강화 (컨텍스트 노출 + 히스토리 심화)

- **작성일**: 2026-07-02
- **타입**: feature (P1)
- **의존**: M6-1/M6-4 (백엔드 도구), #168 (트레이닝 플랜 페이지)

## 1. 목적

M6 도구와 방금 완성된 `/training-plan` 을 더 잘 쓰이게 만든다.

- **M7-1**: 대시보드 진입 즉시 오늘 workout 을 확인 → 사용자가 훈련 페이지로 굳이 안 가도 오늘 할 것이 눈에 들어옴.
- **M7-2**: Archive 목록 요약만으로는 지난 블록에서 실제로 뭘 뛰었는지 알 수 없음 → 특정 archived plan 을 열어 4주 캘린더 + 매칭된 활동 확인.

## 2. 요구사항

### 2.1 M7-1: 대시보드 오늘 workout hero

- [ ] **F1**: 대시보드 (`src/app/page.tsx`) 상단에 **전 폭 hero 카드** 신설. 기존 카드들(활동/수면/심박)보다 위.
- [ ] **F2**: `recommend_today_workout` (또는 `/api/recommend-today`) 결과를 서버에서 fetch.
- [ ] **F3**: Coach's Ledger 톤 (Barlow Condensed + 오렌지 액센트) 유지. 대시보드 나머지 카드와 시각적 대비를 의도적으로 살려 "오늘의 지시" 성격 강조.
- [ ] **F4**: 콘텐츠 컴팩트 버전:
  - 좌측: 큰 타입명 (EASY/TEMPO/…) + 거리 + pace range + zone
  - 우측: readiness / injury 라벨 + score (bar 는 생략, 인디케이터만)
  - 하단: rationale 1줄 (긴 문장은 truncate)
  - CTA: `자세히 →` 링크 → `/training-plan`
- [ ] **F5**: 오늘 rest 케이스 별도 표시 ("REST · 오늘은 회복일" + rationale).
- [ ] **F6**: active plan 없음 케이스 별도 표시 ("트레이닝 플랜 생성하기 →" CTA).
- [ ] **F7**: readiness/injury 데이터 부재 케이스 gracefully degrade (라벨 대신 "데이터 없음").

### 2.2 M7-2: Archived plan 상세 페이지

- [ ] **F8**: 신규 라우트 `/training-plan/history/[planId]` (SSR). archive 리스트 아이템 클릭 시 이 페이지로 이동.
- [ ] **F9**: `GET /api/training-plan/[planId]` route 신규. 파라미터: planId. archived + active 둘 다 열람 허용 (active 는 실질적으로 `/training-plan` 이 더 낫지만 route 는 range 안 정하고 유연히).
- [ ] **F10**: 페이지 콘텐츠:
  - 헤더: 브랜딩 (`myFITNESS · 지난 블록`) + 상단 왼쪽 "← 트레이닝 플랜" 링크
  - Plan meta 섹션: startDate ~ endDate, weeklyFrequency, targetDistance?, baselineWeeklyKm, baselineAcwr, lthrPaceUsed
  - 4주 캘린더: `PlanCalendar` 재사용 (todayStr 은 archive 종료일로 넘겨 "오늘" 하이라이트 없음)
  - 진행률 (frozen at archive close): 완료율은 서버에서 재계산 (M6-1 progress 로직 재사용, plan-history 의 successor cutoff 도 함께 적용)
- [ ] **F11**: archive 리스트 아이템을 `<Link>` 로 감싸서 detail 로 이동.

### 2.3 비기능

- SSR 유지 (`dynamic = "force-dynamic"`).
- Coach's Ledger 톤은 M7-1 카드와 M7-2 페이지 두 곳에서 동일한 폰트/컬러 소스 (`src/app/training-plan/theme.ts` 재사용).
- 폰트 로드: 대시보드 hero 는 `src/app/layout.tsx` 에서 CSS 변수 활성 (또는 대시보드 페이지 로컬 로드). 이미 `src/app/training-plan/fonts.ts` 가 자체 호스팅 → 재사용.
- 응답 토큰 무관 (UI 라우트).

## 3. 기술 설계

### 3.1 파일 구조

```
src/app/page.tsx                                       # 수정: hero 섹션 추가
src/app/components/TodayWorkoutHero.tsx *(신규)*        # 대시보드 hero 카드
src/app/training-plan/history/[planId]/
  page.tsx *(신규)*
  loading.tsx *(신규)*
  error.tsx *(신규)*
src/app/api/training-plan/[planId]/route.ts *(신규)*
src/lib/training/plan-detail.ts *(신규)*                # planId → detail + progress helper
src/app/training-plan/components/ArchivedList.tsx      # 수정: Link 로 이동
src/app/training-plan/components/PlanCalendar.tsx      # 수정 여부 검토 (재사용 가능성 확인)
```

### 3.2 대시보드 hero 컴팩트 컴포넌트

- 별도 컴포넌트로 신설. `TodayWorkoutCard.tsx` 는 페이지 전용이라 hero 로 쓰기엔 큼.
- 프롭: `RecommendPayload | null`.
- Coach's Ledger 톤: `src/app/training-plan/theme.ts` 임포트 + 폰트 CSS 변수 사용.
- 대시보드 layout 에서 `training-plan/fonts.ts` 의 variable 을 활성화해 hero 에서만 override 되게. (fonts CSS variable 은 hero 를 감싼 div 에 class 적용)

### 3.3 Archived detail helper

- `src/lib/training/plan-detail.ts`:
  - 함수: `fetchPlanDetail(planId): Promise<{ plan, workouts, progress }>`
  - active/archived 통합 처리 (status 관계없이 planId 로 조회)
  - progress 재계산: archived 는 successor cutoff 적용, active 는 오늘까지 매칭.
- `PlanCalendar` 는 그대로 재사용. `todayStr` 은 detail page 에서 planId 가 active 면 실제 오늘, archived 면 endDate 로 (하이라이트 사라짐).

### 3.4 응답 스키마 (`GET /api/training-plan/[planId]`)

```jsonc
{
  "plan": {
    "planId": "clx...",
    "status": "archived" | "active",
    "startDate": "2026-06-15",
    "endDate": "2026-07-12",
    "weeklyFrequency": 4,
    "targetDistance": "10K" | null,
    "targetDate": "2026-07-12" | null,
    "baselineWeeklyKm": 32.5,
    "baselineAcwr": 0.95,
    "lthrPaceUsed": 285,
    "createdAt": "2026-06-14T22:00:00.000Z"
  },
  "workouts": [
    { "date": "2026-06-15", "type": "easy", "distanceKm": 6.5, "pace": "5:42", "zone": "Z2",
      "status": "completed", "matched": { "distanceKm": 6.42, "actualPace": "5:38" } },
    // ... 28개
  ],
  "progress": { "total": 20, "completed": 16, "missed": 2, "pending": 2, "completionPct": 80.0 }
}
```

## 4. 변경 파일

- `docs/specs/m7-training-plan-ux.md` *(신규 스펙)*
- `src/app/page.tsx` — hero 섹션 추가 + fetch
- `src/app/components/TodayWorkoutHero.tsx` *(신규)*
- `src/app/layout.tsx` — training-plan 폰트 variable 을 body 전체에서 접근 가능하게 활성 (또는 대시보드 라우트에서만)
- `src/app/api/training-plan/[planId]/route.ts` *(신규)*
- `src/lib/training/plan-detail.ts` *(신규)*
- `src/app/training-plan/history/[planId]/{page,loading,error}.tsx` *(신규)*
- `src/app/training-plan/components/ArchivedList.tsx` — 아이템 `<Link>` 로 감싸기

## 5. 테스트 계획

`npm run lint && npm run typecheck && npm run build` 3종.

수동:
1. 대시보드 진입 → hero 카드 정상 렌더링 (rest / 활성 workout / active plan 없음 / factors 없음 케이스)
2. 트레이닝 플랜 → Archive 리스트 아이템 클릭 → 상세 페이지로 이동
3. Archived detail 페이지: 캘린더 표시, "오늘" 하이라이트 없음, 진행률 frozen 값
4. Detail 페이지에서 "← 트레이닝 플랜" 링크로 복귀

## 6. 제외 사항

- Push/이메일로 오늘 workout 알림 (별도 후속)
- 대시보드 오늘 카드에서 workout 완료 마킹 (자동 activity 매칭 유지)
- Archive 상세 페이지에서 workout 편집/삭제 (read-only)
- Active plan 상세 뷰어 페이지 (이미 `/training-plan` 이 그 역할)

## 7. 롤백

`git revert`. DB/env 영향 없음.
