# M8: 트레이닝 플랜 목표별 스케일링 + 편집·취소

- **작성일**: 2026-07-02
- **타입**: feature/fix (P1)
- **의존**: M6-1 (`generateTrainingPlan`), #168 (트레이닝 플랜 페이지), M7 (히스토리 상세)

## 1. 목적

두 가지 실제 사용상 문제를 함께 해결.

- **문제 A**: `targetDistance` (5K/10K/HM/FM) 를 지정해도 플랜 볼륨이 사실상 동일 → 하프/풀 목표에 맞는 준비량이 나오지 않음. 근본 원인은 `plan-generator.ts` 가 `baselineWeeklyKm` (최근 28일 히스토리) 만 사용하고 target 은 race day 표기에만 반영하기 때문.
- **문제 B**: 생성된 플랜에서 개별 workout 변경이나 플랜 취소가 안 됨 → 컨디션/스케줄 변경에 대응할 방법이 재생성밖에 없음.

## 2. 요구사항

### 2.1 목표별 볼륨 스케일링 (A)

- [ ] **F1**: 목표별 볼륨 배율 상수 (A 접근):
  ```
  TARGET_VOLUME_MULT = {
    "5K":  0.90,
    "10K": 1.00,
    "HM":  1.35,
    "FM":  1.90,
  }
  ```
  target 미지정 (일반 fitness) 시 배율 1.0.
- [ ] **F2**: 사용자 히스토리 sanity cap (C 접근): 실측 최근 4주 최대 주간 km × 1.15 을 상한으로 사용.
  - 목적: baseline 이 낮은 사용자에게 목표만 크다고 무리한 상향 방지.
  - 4주 통합 최대: 최근 28일 데이터에서 각 7일 슬라이드 창의 최대값.
- [ ] **F3**: 최종 baseline 산출:
  ```
  scaledBase = baselineWeeklyKm × TARGET_VOLUME_MULT[target]
  historicalCap = historicalMaxWeekKm × 1.15
  finalBase = min(scaledBase, historicalCap)  // sanity
  finalBase = max(finalBase, MIN_BASELINE_WEEKLY_KM)  // 저볼륨 안전선 15km 유지
  ```
  `finalBase` 는 `generatePlan.baselineWeeklyKm` 로 전달.
- [ ] **F4**: 응답 payload 에 `baselineWeeklyKm` 옆에 새 필드 `scaledForTarget` (bool) 노출 → UI/디버그에서 baseline 이 target 으로 조정됐는지 확인 가능.
- [ ] **F5**: 목표별 long run 피크 최소 (B 접근 보조): 위 스케일링 후에도 Wk3 long run 이 목표별 최소값보다 낮으면 **long slot 만** 개별 승격:
  ```
  PEAK_LONG_MIN_KM = { 5K: 7, 10K: 12, HM: 18, FM: 27 }
  ```
  다른 slot 은 유지 → 사용자 부담 완화.

### 2.2 개별 workout 편집

- [ ] **F6**: 신규 API `PATCH /api/training-plan/[planId]/workouts/[date]`.
  - 입력: `{ type?, distanceKm?, pace?, zone?, intervalDesc?, notes? }` (부분 필드)
  - 검증: type 은 유효값, distanceKm ≥ 0, pace 는 "m:ss" 형식 등.
  - active plan 만 편집 허용 (archived → 409).
  - `PATCH` 후 응답에 갱신된 workout 전체 반환.
- [ ] **F7**: `/training-plan` 페이지의 셀 클릭/탭 → 인라인 편집 모달 (모바일 bottom sheet).
  - 필드: type / distanceKm / pace / zone / notes.
  - Pace 는 `m:ss` 문자열 입력, 서버가 sec/km 로 변환.
  - "삭제" 버튼 → workout 을 rest 로 되돌림 (DB row 유지, type=rest).

### 2.3 플랜 취소

- [ ] **F8**: 신규 API `POST /api/training-plan/[planId]/cancel`.
  - active plan 만 취소 가능. status → "archived". 후속 plan 없음.
  - 이후 `recommend_today_workout` 은 no active plan 상태로 fallback.
- [ ] **F9**: `/training-plan` 페이지 Regenerate 폼 옆 secondary 버튼 "플랜 취소".
  - 확인 다이얼로그 (덮어씀 경고와 별도, 취소 후엔 새 plan 없이 그냥 종료).

### 2.4 비기능

- 편집/취소 는 mutating → **allowedTools 제외 유지**. UI/API 명시 호출만.
- DB 마이그레이션 없음 (기존 컬럼 활용).
- 응답 토큰 무관.

## 3. 기술 설계

### 3.1 파일 구조

```
src/lib/training/
  plan-scaling.ts *(신규)*        # target-aware baseline 계산
  workout-editor.ts *(신규)*      # workout 필드 validation + apply

src/mcp/tools/training-plan.ts    # generateTrainingPlan 이 plan-scaling 사용
src/app/api/training-plan/[planId]/
  workouts/[date]/route.ts *(신규)*  # PATCH
  cancel/route.ts *(신규)*           # POST

src/app/training-plan/components/
  WorkoutEditModal.tsx *(신규)*    # 셀 클릭 시 모달
  PlanCalendar.tsx                # 셀에 onClick prop 추가
  # (Server component 라 client wrapper 필요 시 신규)
```

### 3.2 볼륨 스케일링 helper

```ts
// src/lib/training/plan-scaling.ts
export function computeHistoricalMaxWeekKm(rows: RunRow[]): number {
  // 최근 28일 데이터에서 7일 슬라이딩 윈도우 최대 주간 km.
}
export function scaleBaseline(
  baseline: number,
  targetDistance: TargetDistance | null,
  historicalMax: number
): { finalBase: number; scaledForTarget: boolean } { ... }
```

### 3.3 편집 API validation

- Prisma 트랜잭션: 조회 (active plan 검증) → update.
- Zod 스키마로 body 검증 + 400 응답.

### 3.4 취소 API

- 트랜잭션: findFirst active → updateMany where id + status → status="archived".
- 하나의 active plan 만 있을 것이라 unique 제약 없이도 안전.

## 4. 변경 파일

- `docs/specs/m8-plan-scaling-editing.md` *(신규)*
- `src/lib/training/plan-scaling.ts` *(신규)*
- `src/lib/training/workout-editor.ts` *(신규)*
- `src/mcp/tools/training-plan.ts` — baseline 계산에 scaleBaseline 통합
- `src/app/api/training-plan/[planId]/workouts/[date]/route.ts` *(신규 PATCH)*
- `src/app/api/training-plan/[planId]/cancel/route.ts` *(신규 POST)*
- `src/app/training-plan/components/WorkoutEditModal.tsx` *(신규)*
- `src/app/training-plan/components/PlanCalendar.tsx` — 셀 onClick 훅
- `src/app/training-plan/page.tsx` — 취소 CTA + 모달 상태

## 5. 테스트 계획

`npm run lint && npm run typecheck && npm run build` 3종.

수동:
1. baseline 30 km/wk 사용자 → HM 목표 → Wk3 long run ≥ 18 km 확인
2. baseline 15 km/wk (저볼륨) 사용자 → FM 목표 → historicalCap 으로 무리한 상향 방지 확인
3. Wk1 tempo 셀 클릭 → 모달 → distance 6 → 8 km 수정 → refresh 후 반영 확인
4. 임의 workout 삭제 → rest 로 되돌아감
5. 플랜 취소 → active plan null, 대시보드 hero 는 Empty 상태
6. Archived plan 상세 페이지에서 편집 시도 → 409

## 6. 제외 사항

- 개별 완료 여부 수동 마킹 (기존과 동일하게 activity 자동 매칭 유지)
- 목표별 세션 구성 재설계 (예: FM 은 저강도 volume 강화, HM 은 tempo 비중 ↑ 등)
- 편집 히스토리 (누가 언제 뭘 바꿨는지) — 개인 앱이라 불필요
- 취소 후 자동 새 plan 제안 — 사용자가 명시적으로 생성

## 7. 롤백

`git revert`. DB / env 영향 없음 (신규 필드 없음, 기존 필드만 사용).
