-- AlterTable: M4-5 운동 강도 자동 분류 필드
ALTER TABLE "Activity"
  ADD COLUMN "zoneDistribution" JSONB,
  ADD COLUMN "estimatedZone" INTEGER,
  ADD COLUMN "intensityScore" DOUBLE PRECISION,
  ADD COLUMN "intensityLabel" TEXT;
