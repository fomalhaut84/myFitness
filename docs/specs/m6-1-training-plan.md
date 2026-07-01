# M6-1: `generate_training_plan` / `get_active_training_plan` MCP 도구

- **작성일**: 2026-07-01
- **타입**: feature (P1)
- **마일스톤**: M6 (`docs/specs/m6-overview.md`)
- **백엔드 전용** (DB 마이그레이션 포함)

## 1. 목적

사용자 프로필(LTHR/maxHR/Zone) + 최근 러닝 히스토리 + 선택적 race 목표 → 4주 단위 트레이닝 계획을 결정적으로 생성. AI 가 "다음 4주 어떻게 뛰면 좋을까?" 질문에 일관된 근거로 계획 제시 + M6-4 (`recommend_today_workout`) 의 기반.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 신규 MCP 도구 `generate_training_plan`.
  - 입력:
    - `weeklyFrequency` (3 ~ 5, default 4)
    - `targetDistance` ("5K" | "10K" | "HM" | "FM", optional)
    - `targetDate` (ISO date, optional. targetDistance 와 함께만 유효, plan 4주 창 내에 있어야 tapering 적용)
  - 동작:
    - 기존 active plan 이 있으면 `status = "archived"` 로 표시
    - 새 plan 생성 (내일부터 28일)
    - 각 workout 을 `TrainingWorkout` 로 upsert
    - 생성된 plan + workouts 요약 반환
- [ ] **F2**: 신규 MCP 도구 `get_active_training_plan`.
  - 입력: 없음
  - 동작:
    - 현재 active plan 조회 (없으면 `{ plan: null }`)
    - 각 workout 에 대해 진행 상태 파생 (읽기 시점, 저장 X):
      - `date ≤ 오늘` + 매칭 Activity 존재 → `completed`, `matchedActivity` 포함
      - `date ≤ 오늘` + 매칭 없음 → `missed`
      - `date > 오늘` → `pending`
    - 매칭 규칙: workout.date (KST day) 와 같은 KST 일자에 러닝 activity 존재. distance 90 % 이상이면 match. (다중 매칭 시 최근/가장 긴 것 우선)
    - 요약: 총 workout / completed / missed / pending, 완료율
- [ ] **F3**: DB 모델
  - `TrainingPlan`: 계획 헤더 (기간, 옵션, 기준 지표, status)
  - `TrainingWorkout`: 개별 workout (date, type, distance/pace/zone, 노트)
  - 마이그레이션 파일 생성
- [ ] **F4**: 결정적 plan 생성 로직
  - **baseline 주간 km**: 최근 28일 러닝 총 km / 4. 데이터 부족 시 (< 5 km/wk) 15 km 기본
  - **주간 progression**: Wk1 baseline (×1.0), Wk2 (×1.1), Wk3 (×1.2, peak), Wk4 (×0.8, recovery). ACWR 10 % 이하 유지
  - **race taper**: targetDate 가 Wk4 내에 있으면 Wk4 볼륨 을 targetDate 까지 선형 감소 (60 % 시작 → race 당일 rest)
  - **weekly 패턴** (요일 고정, Mon = 0):
    - 3x: Tue easy(20 %), Thu tempo(20 %), Sat long(35 %). 나머지 rest. (weekly 총 = 75 % → recovery/보수적)
    - 4x: Mon easy(15 %), Wed tempo(20 %), Thu recovery(10 %), Sat long(30 %). 나머지 easy or rest → 총 75 %.
      - **정정**: Tue easy(20 %), Wed easy(15 %), Thu tempo(20 %), Sat long(35 %) = 90 %
    - 5x: Mon easy(15 %), Tue interval(15 %), Wed easy(15 %), Thu tempo(15 %), Sat long(30 %) = 90 %
  - **workout 타입 → zone**:
    - `easy` → Z2, pace = LTHR pace × 1.20 (18 % 느림)
    - `long` → Z2, pace = LTHR pace × 1.22
    - `tempo` → Z3-4, pace = LTHR pace × 1.05
    - `interval` → Z5, pace = LTHR pace × 0.95, 짧은 반복 (예: 6 × 400 m)
    - `recovery` → Z1, pace = LTHR pace × 1.30
    - `rest` → distance 0, pace null, notes = "휴식"
  - LTHR pace 부재 시: **LTHR pace = 최근 러닝 평균 pace / 1.10** 을 pseudo-LTHR 로 사용 (avg 가 LTHR 보다 10 % 느리다는 가정; workout 배율과 정합)
- [ ] **F5**: 응답 스키마 compact JSON (M6-3 학습). 각 workout summary 1 줄.

### 2.2 비기능

- KST 기준. 모든 workout date 는 `@db.Date` (시간 없음).
- Plan 활성 상태 유지: `status = "active"` 는 최대 1개 (unique 제약 대신 DB 함수 대신 코드로 관리).
- 응답 토큰 ≤ 1200 (`generate` 첫 응답 요약 + 28 workouts). `get_active_training_plan` 도 유사.
- 마이그레이션은 `prisma migrate dev --name training_plan`.

## 3. 기술 설계

### 3.1 DB 스키마 (schema.prisma 추가)

```prisma
model TrainingPlan {
  id              String   @id @default(cuid())
  createdAt       DateTime @default(now())
  startDate       DateTime @db.Date       // KST day, 내일부터 시작
  endDate         DateTime @db.Date       // startDate + 27 일
  weeklyFrequency Int                     // 3 | 4 | 5
  targetDistance  String?                 // "5K" | "10K" | "HM" | "FM"
  targetDate      DateTime? @db.Date
  baselineWeeklyKm Float?                 // 생성 시점의 baseline
  baselineAcwr    Float?                  // 생성 시점 ACWR
  lthrPaceUsed    Float?                  // 생성에 사용된 LTHR pace (sec/km). 부재 시 pseudo 값
  status          String   @default("active") // "active" | "archived"
  workouts        TrainingWorkout[]

  @@index([status, createdAt])
}

model TrainingWorkout {
  id            String        @id @default(cuid())
  planId        String
  plan          TrainingPlan  @relation(fields: [planId], references: [id], onDelete: Cascade)
  date          DateTime      @db.Date
  weekNumber    Int                       // 1 ~ 4
  dayIndex      Int                       // 0 (Mon) ~ 6 (Sun)
  type          String                    // "easy" | "long" | "tempo" | "interval" | "recovery" | "rest"
  distanceKm    Float?                    // null for rest
  paceSecPerKm  Int?                      // target
  zone          String?                   // "Z1" | "Z2" | "Z3-4" | "Z5"
  intervalDesc  String?                   // "6x400m Z5, jog 200m" (interval 만)
  notes         String?                   // 짧은 코칭 노트 (한글)

  @@unique([planId, date])
  @@index([date])
}
```

### 3.2 파일 구조

- `prisma/migrations/<ts>_training_plan/migration.sql` *(자동 생성)*
- `prisma/schema.prisma` — 위 2 모델 추가
- `src/lib/training/plan-generator.ts` — plan 생성 core 로직 (input → workout[])
- `src/lib/training/workout-patterns.ts` — weeklyFrequency 별 요일 패턴 + 볼륨 비율
- `src/lib/training/pace-calc.ts` — LTHR/baseline 페이스에서 workout 별 pace 계산
- `src/mcp/tools/training-plan.ts` — `generate_training_plan`, `get_active_training_plan` 두 tool export
- `src/mcp/server.ts` — 두 tool 등록
- `src/lib/ai/claude-advisor.ts` — allowedTools 에 추가

### 3.3 응답 스키마

`generate_training_plan`:
```jsonc
{
  "planId": "clx…",
  "startDate": "2026-07-02",
  "endDate": "2026-07-29",
  "weeklyFrequency": 4,
  "targetDistance": "10K",
  "targetDate": "2026-07-25",
  "baselineWeeklyKm": 32.5,
  "baselineAcwr": 0.95,
  "lthrPaceUsed": 285,
  "weeks": [
    {
      "week": 1,
      "totalKm": 32.5,
      "workouts": [
        { "date": "2026-07-02", "type": "rest" },
        { "date": "2026-07-03", "type": "easy",  "distanceKm": 6.5,  "pace": "5:42", "zone": "Z2" },
        { "date": "2026-07-04", "type": "easy",  "distanceKm": 4.9,  "pace": "5:42", "zone": "Z2" },
        { "date": "2026-07-05", "type": "tempo", "distanceKm": 6.5,  "pace": "4:59", "zone": "Z3-4" },
        { "date": "2026-07-08", "type": "long",  "distanceKm": 11.4, "pace": "5:48", "zone": "Z2" }
      ]
    },
    // week 2 ~ 4
  ],
  "archivedPreviousPlanId": "cly…"    // 있을 때만
}
```

`get_active_training_plan`:
```jsonc
{
  "plan": {
    "planId": "clx…",
    "startDate": "2026-07-02",
    "endDate": "2026-07-29",
    "weeklyFrequency": 4,
    "targetDistance": "10K",
    "targetDate": "2026-07-25"
  },
  "progress": { "total": 20, "completed": 6, "missed": 1, "pending": 13, "completionPct": 30.0 },
  "todayWorkout": { "date": "2026-07-11", "type": "tempo", "distanceKm": 6.5, "pace": "4:59", "zone": "Z3-4" },
  "workouts": [
    {
      "date": "2026-07-03", "type": "easy", "distanceKm": 6.5, "pace": "5:42", "zone": "Z2",
      "status": "completed",
      "matched": { "distanceKm": 6.42, "actualPace": "5:38" }
    },
    // ...
  ]
}
```

## 4. 변경 파일

- `prisma/schema.prisma`
- `prisma/migrations/<ts>_training_plan/migration.sql` *(신규)*
- `src/lib/training/plan-generator.ts` *(신규)*
- `src/lib/training/workout-patterns.ts` *(신규)*
- `src/lib/training/pace-calc.ts` *(신규)*
- `src/mcp/tools/training-plan.ts` *(신규)*
- `src/mcp/server.ts`
- `src/lib/ai/claude-advisor.ts`

## 5. 테스트 계획

`npm run lint && npm run typecheck && npm run build` 3종.

수동 확인:
1. 마이그레이션 적용 (`npm run prisma:migrate`).
2. 개발 서버에서 MCP 도구 직접 호출: `generate_training_plan({ weeklyFrequency: 4, targetDistance: "10K", targetDate: "2026-07-25" })`.
3. 재호출 → 이전 plan `archived`, 신규 `active` 확인.
4. `get_active_training_plan()` → 요일별 workout 있는지 + 오늘 workout 매칭 확인.

## 6. 제외 사항

- 사용자가 workout 수동 완료 표시 (진행은 activity 매칭으로 자동 파생)
- Web UI (본 이슈는 백엔드/MCP 전용, UI 는 별도 이슈)
- Plan 중간 재생성/수정 API (재호출로 archived 처리로 충분)
- Cross-plan 진행 히스토리 (M6 범위 밖)
- 4주 이외 기간 지원 (고정 4주)

## 7. 롤백

- `prisma migrate resolve --rolled-back <migration>` + `git revert`. 데이터는 새 테이블만 추가되므로 기존 데이터 영향 없음.
