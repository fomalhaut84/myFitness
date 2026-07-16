-- M13 Phase 2 (#249): WorkoutAdjustment 신규 테이블.
-- auto-adjust 제안 + confirm/reject/snooze 이력. workoutId 는 nullable
-- (fallback 케이스 대비, 현재는 미사용). ON DELETE SET NULL 로 workout 삭제 시 이력 유지.

CREATE TABLE "WorkoutAdjustment" (
  "id"                   TEXT NOT NULL,
  "workoutId"            TEXT,
  "proposedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt"            TIMESTAMP(3),
  "decision"             TEXT NOT NULL DEFAULT 'pending',
  "proposedType"         TEXT NOT NULL,
  "proposedDistanceKm"   DOUBLE PRECISION,
  "proposedPaceSecPerKm" INTEGER,
  "proposedZone"         TEXT,
  "proposedIntervalDesc" TEXT,
  "reason"               JSONB,
  "rejectReason"         TEXT,
  "telegramMessageId"    TEXT,
  "telegramChatId"       TEXT,
  "snoozeUntil"          TIMESTAMP(3),

  CONSTRAINT "WorkoutAdjustment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WorkoutAdjustment"
  ADD CONSTRAINT "WorkoutAdjustment_workoutId_fkey"
  FOREIGN KEY ("workoutId") REFERENCES "TrainingWorkout"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WorkoutAdjustment_decision_snoozeUntil_idx"
  ON "WorkoutAdjustment"("decision", "snoozeUntil");

CREATE INDEX "WorkoutAdjustment_workoutId_idx"
  ON "WorkoutAdjustment"("workoutId");

CREATE INDEX "WorkoutAdjustment_telegramMessageId_idx"
  ON "WorkoutAdjustment"("telegramMessageId");
