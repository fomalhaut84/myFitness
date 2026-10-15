-- #514: OMRON Connect 직접 연동 — 혈압 출처 · OMRON 체성분 필드 (additive · nullable / DEFAULT)

ALTER TABLE "BloodPressure"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'garmin';

ALTER TABLE "BodyComposition"
  ADD COLUMN "visceralFatLevel" DOUBLE PRECISION,
  ADD COLUMN "basalMetabolism" INTEGER,
  ADD COLUMN "bodyAge" INTEGER,
  ADD COLUMN "skeletalMusclePct" DOUBLE PRECISION;

-- 출처 값 제약: BodyComposition 은 기존 ('garmin', 'manual') 에 'omron' 추가 · BloodPressure 는 신규 (같은 패턴)
ALTER TABLE "BodyComposition" DROP CONSTRAINT "BodyComposition_source_check";
ALTER TABLE "BodyComposition" ADD CONSTRAINT "BodyComposition_source_check" CHECK ("source" IN ('garmin', 'manual', 'omron'));
ALTER TABLE "BloodPressure" ADD CONSTRAINT "BloodPressure_source_check" CHECK ("source" IN ('garmin', 'omron'));
