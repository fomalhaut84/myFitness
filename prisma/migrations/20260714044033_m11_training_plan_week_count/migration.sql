-- M11 Phase 1 (#222): TrainingPlan.weekCount 필드 추가.
-- 기존 record 는 모두 4주 고정으로 생성되었으므로 DEFAULT 4 로 백필됨 (NOT NULL 안전).

ALTER TABLE "TrainingPlan"
  ADD COLUMN "weekCount" INTEGER NOT NULL DEFAULT 4;
