-- M13 Phase 2 (#249, PR #250 pre-review P2 대응): Accept 시 원 workout 값이 덮어써지는
-- 데이터 손실 방지. WorkoutAdjustment 에 original* 스냅샷 컬럼 + TrainingWorkout 에
-- authoritative autoAdjusted flag (notes prefix 파생은 사용자 편집으로 무너짐).

ALTER TABLE "WorkoutAdjustment"
  ADD COLUMN "originalType"         TEXT,
  ADD COLUMN "originalDistanceKm"   DOUBLE PRECISION,
  ADD COLUMN "originalPaceSecPerKm" INTEGER,
  ADD COLUMN "originalZone"         TEXT,
  ADD COLUMN "originalIntervalDesc" TEXT,
  ADD COLUMN "originalNotes"        TEXT;

ALTER TABLE "TrainingWorkout"
  ADD COLUMN "autoAdjusted" BOOLEAN NOT NULL DEFAULT false;
