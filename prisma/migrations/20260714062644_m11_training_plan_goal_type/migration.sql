-- M11 Phase 2 (#232): TrainingPlan.goalType + goalValue 필드 추가.
-- 기존 record 는 모두 거리 목표(5K/10K/HM/FM 또는 free) 로 생성되었으므로
-- DEFAULT 'distance' 로 백필 (NOT NULL 안전). goalValue 는 JSON payload (NULL 허용).

ALTER TABLE "TrainingPlan"
  ADD COLUMN "goalType" TEXT NOT NULL DEFAULT 'distance',
  ADD COLUMN "goalValue" JSONB;
