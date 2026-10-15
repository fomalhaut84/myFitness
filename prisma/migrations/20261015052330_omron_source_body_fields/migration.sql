-- #514: OMRON Connect 직접 연동 — 혈압 출처 · OMRON 체성분 필드 (additive · nullable / DEFAULT)

ALTER TABLE "BloodPressure"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'garmin';

ALTER TABLE "BodyComposition"
  ADD COLUMN "visceralFatLevel" DOUBLE PRECISION,
  ADD COLUMN "basalMetabolism" INTEGER,
  ADD COLUMN "bodyAge" INTEGER,
  ADD COLUMN "skeletalMusclePct" DOUBLE PRECISION;
