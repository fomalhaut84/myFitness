# M13: 자동 조정 + 사전 알림 (마일스톤)

- **작성일**: 2026-07-15
- **타입**: milestone
- **관련 이슈**: (Phase 별 개별 이슈 예정)
- **선행 완료**: v2.14.0 (Training Plan goalType 4-way), v2.14.1 (SyncMetadata 근본 fix)
- **관련 검토 항목**: M11 Phase 3 (진행 트래킹 & 자동 조정 — 검토 단계) → M13 으로 승격

## 목적

훈련 계획이 있어도 하루 컨디션 (readiness / 부상 위험) 이 나쁘면 무리한 실행이 부상/과훈련으로 이어짐. 현재 도구 (`getInjuryRiskScore`, `recommendTodayWorkout`) 는 요청 시점에만 조언, 사용자가 직접 조회해야 함.

M13 은 **아침 시점에 오늘 workout 을 자동 평가 → 필요 시 down-scale 제안 → Telegram 사전 알림 → confirm/reject → TrainingPlan 반영** 을 자동화. 사용자는 알림만 확인하면 됨.

## 현재 자산 (재사용)

- **MCP**: `getInjuryRiskScore` (0-100 + label + top 3 factors), `recommendTodayWorkout` (adjusted 여부 + reason 이미 반환)
- **DB**: `TrainingWorkout` (오늘의 계획), `AIAdvice` (조언 이력), `TrainingPlan` (active plan)
- **Bot infra**: `startBotScheduler` (node-cron), `sendToAll` (Telegram push), inline keyboard 미사용
- **Report cron**: morning 08:00 / evening 23:00 / weekly Monday 07:00 (`bot/notifications/scheduler.ts`)

## Phase 구성

### Phase 1 — 사전 알림 (read-only)

**요구사항**:
- 아침 이른 시각 (기본 06:30 KST, env 변수 `AUTO_ADJUST_CRON`) 에 cron 트리거
- `recommendTodayWorkout` 실행 → `recommendation.adjusted === true` 인 경우만 Telegram push
- 알림 메시지 포함:
  - Injury risk score + label (safe/caution/elevated/high)
  - Top 3 기여 factors
  - 원래 계획 (type / distance / pace)
  - 조정 제안 (type / distance / paceRange / adjustmentReason)
  - **아직 confirm/reject flow 없음 — Phase 2 에서 도입**
- `AIAdvice` 카테고리 확장: `"auto_adjust_proposal"` 추가 (audit trail)
- Setting toggle: `UserProfile.autoAdjustEnabled Boolean @default(true)` — 알림 on/off

**scope 제한**: 계획 변경 없음. 사용자에게 정보 전달만.

### Phase 2 — Confirm / Reject flow

**요구사항**:
- Phase 1 알림에 Telegram inline keyboard (Accept / Reject / Snooze) 추가
- **제안 발송 범위 축소**: `todayIsRestPlanned=true` 뿐 아니라 **실제 계획된 TrainingWorkout 이 있을 때만** 제안 (fallback base 인 no-plan 케이스 skip). 이유: Accept 시 실제 update 대상이 없으면 audit 만 남고 사용자 혼란
- Callback 처리:
  - **Accept**: 오늘 `TrainingWorkout` 을 조정된 값으로 update (type/distanceKm/paceSecPerKm/notes/zone/intervalDesc). `notes` 에 "M13 auto-adjust: <reason>" prefix
  - **Reject**: 원 계획 유지. UI 에서 선택 이유 텍스트 입력 시 rejectReason 축적 (개선 지표)
  - **Snooze**: DB `snoozeUntil = now + 1h` 저장 → 5분 주기 cron 이 due 되면 원 메시지 재전송 (재평가 없이). pm2 restart 생존.
- 신규 model `WorkoutAdjustment`:
  ```
  id, workoutId (fk, nullable — fallback 케이스는 미사용 이지만 향후 확장 대비), proposedAt,
  decidedAt?, decision ("pending"|"accepted"|"rejected"|"snoozed"|"expired"),
  proposedType, proposedDistanceKm, proposedPaceSecPerKm, proposedZone, proposedIntervalDesc,
  reason Json (factors snapshot),
  rejectReason?, telegramMessageId?, telegramChatId?, snoozeUntil DateTime?
  ```
- **TTL 자동 처리**: 5분 cron (snooze re-send cron 과 통합) 이 다음 조건 pending → expired:
  - 자정 KST 지남 (당일 workout 시각 지남)
  - 또는 proposedAt+8h 초과 (안전망)
- Web UI: `/training-plan` 페이지에 조정된 workout 표시 (dashed border + "auto-adjusted" 뱃지). PlanCalendar 에서 workout.notes 에 "M13 auto-adjust" prefix 있으면 렌더링.

### Phase 3 — Analytics & 임계값 튜닝

**요구사항**:
- Adjustment history 대시보드 (`/training-plan/adjustments`):
  - 최근 30일 조정 count, accept/reject 비율
  - Injury score vs 실제 부상 발생 상관 (기간 축적 필요)
  - Reject 이유 patterns
- `injury_risk` 스코어 임계값 조정: 사용자가 자주 reject 하면 임계값 상향 (또는 factor 가중치 조정)
- **미확정**: 데이터 3개월 축적 후 착수

## Data Model 확장 (Phase 2)

```prisma
model WorkoutAdjustment {
  id                    String   @id @default(cuid())
  workoutId             String
  workout               TrainingWorkout @relation(fields: [workoutId], references: [id], onDelete: Cascade)
  proposedAt            DateTime @default(now())
  decidedAt             DateTime?
  decision              String   @default("pending") // "pending"|"accepted"|"rejected"|"snoozed"|"expired"
  // 조정 스냅샷 (원 계획은 workout 필드 그대로)
  proposedType          String
  proposedDistanceKm    Float?
  proposedPaceSecPerKm  Int?
  reason                Json    // { injuryScore, injuryLabel, factors: [...], adjustmentReason }
  rejectReason          String?
  telegramMessageId     String?  // callback 매칭용

  @@index([workoutId])
  @@index([decidedAt, decision])
}

model TrainingWorkout {
  // ... 기존 필드
  adjustments WorkoutAdjustment[]
}
```

`UserProfile.autoAdjustEnabled Boolean @default(true)` 추가 (Phase 1).

## 알림 flow (Phase 2)

```
06:30 KST cron
  → recommendTodayWorkout()
  → adjusted === true?
    ├─ No → skip (조용)
    └─ Yes:
       ├─ WorkoutAdjustment 레코드 생성 (decision=pending)
       ├─ Telegram push (inline keyboard: Accept/Reject/Snooze)
       └─ AIAdvice 로그 (category=auto_adjust_proposal)

User 클릭:
  → callback_query 처리
  → decision 갱신, decidedAt=now
  → Accept: TrainingWorkout update + 확인 메시지
  → Reject: 사유 물어봄 (optional text reply) + 원 계획 유지 안내
  → Snooze: 1시간 후 재알림 예약

TTL: workout 시각 (기본 오늘 09:00 이후) 지나면 자동 expired 처리
```

## Phase 1 우선 요구사항 (착수 준비)

- **F1**: `UserProfile.autoAdjustEnabled` 필드 + migration (기본 true)
- **F2**: `bot/notifications/scheduler.ts` 에 `autoAdjustSchedule` (기본 `30 6 * * *`) cron 추가
- **F3**: 알림 로직 함수 (`sendAutoAdjustProposal`): recommendTodayWorkout → adjusted 검사 → 메시지 포맷 → sendToAll
- **F4**: `AIAdvice.category` 값에 `"auto_adjust_proposal"` 추가 (schema enum 없이 String, 문서만 갱신)
- **F5**: Setting UI `/settings/profile` 에 autoAdjust toggle
- **F6**: 알림 메시지 포맷 (Korean, injury factor top 3 강조)
- **F7**: 조용한 실패 방지 (error → sendToAll 로 알림, 기존 pattern 준수)

## Phase 2 요구사항 (Phase 1 완료 후 착수)

- WorkoutAdjustment model + migration
- Telegram inline keyboard + callback handler
- Accept 시 TrainingWorkout update 로직
- Web UI 조정 표시 (`/training-plan` PlanCalendar 확장)
- TTL 만료 처리 (cron 09:30 KST 로 expired 갱신)

## Phase 3 요구사항 (검토 단계)

- Adjustment analytics dashboard
- 임계값 튜닝 로직 (사용자 pattern 학습)
- 축적 데이터 3개월 후 착수 판단

## 제외 사항

- **자동 accept**: 사용자 개입 없이 계획 변경 X (통제감 유지)
- **다중 세션 하루**: 오늘 1개 workout 만 조정 대상 (multi-session 지원은 별도)
- **race day 자동 조정**: race day 는 rest 강제 (기존), 자동 조정 대상 아님

## 참고

- 기존 MCP: `src/mcp/tools/recommend-today-workout.ts`, `src/mcp/tools/injury-risk.ts`
- Bot infra: `src/bot/notifications/scheduler.ts`, `src/bot/index.ts`
- Ecosystem: `myfitness-bot` PM2 프로세스 (standalone.cjs)
