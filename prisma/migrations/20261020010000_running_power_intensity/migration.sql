-- #570: 러닝 역치파워 · 파워 존 + 강도 평가 기준 (컬럼 추가만 — 기존 데이터 보존)
-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN "thresholdPower" INTEGER,
ADD COLUMN "thresholdPowerSource" TEXT,
ADD COLUMN "thresholdPowerAutoDetected" BOOLEAN,
ADD COLUMN "thresholdPowerMeasuredAt" TIMESTAMP(3),
ADD COLUMN "powerZonesRaw" JSONB,
ADD COLUMN "intensityBasis" TEXT NOT NULL DEFAULT 'hr';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "intensityBasis" TEXT;

-- 기존 강도 값은 전부 심박 기준으로 계산됐다
UPDATE "Activity" SET "intensityBasis" = 'hr' WHERE "zoneDistribution" IS NOT NULL;

-- 값 제약 (Prisma 미추적 — memory: source 컬럼 CHECK 패턴)
ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_thresholdPowerSource_check"
    CHECK ("thresholdPowerSource" IS NULL OR "thresholdPowerSource" IN ('manual', 'garmin')),
  ADD CONSTRAINT "UserProfile_intensityBasis_check"
    CHECK ("intensityBasis" IN ('hr', 'power', 'auto'));
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_intensityBasis_check"
    CHECK ("intensityBasis" IS NULL OR "intensityBasis" IN ('hr', 'power'));
