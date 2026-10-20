-- #570: 러닝 역치파워 · 파워 존 + 강도 평가 기준 (컬럼 추가만 — 기존 심박 강도 값은 건드리지 않는다)
-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN "thresholdPower" INTEGER,
ADD COLUMN "thresholdPowerSource" TEXT,
ADD COLUMN "thresholdPowerAutoDetected" BOOLEAN,
ADD COLUMN "thresholdPowerMeasuredAt" TIMESTAMP(3),
ADD COLUMN "powerZonesRaw" JSONB,
ADD COLUMN "intensityBasis" TEXT NOT NULL DEFAULT 'hr';

-- AlterTable — 파워 기준 강도는 심박 기준 컬럼 옆에 따로 (값은 싱크 · scripts/backfill-intensity.ts 가 채운다)
ALTER TABLE "Activity" ADD COLUMN "powerZoneDistribution" JSONB,
ADD COLUMN "powerEstimatedZone" INTEGER,
ADD COLUMN "powerIntensityScore" DOUBLE PRECISION,
ADD COLUMN "powerIntensityLabel" TEXT;

-- AlterTable — 강도 기준 "자동" 의 판단 근거 (심박 영향 복약 기간)
ALTER TABLE "Medication" ADD COLUMN "affectsHeartRate" BOOLEAN NOT NULL DEFAULT false;

-- 값 제약 (Prisma 미추적 — memory: source 컬럼 CHECK 패턴)
ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_thresholdPowerSource_check"
    CHECK ("thresholdPowerSource" IS NULL OR "thresholdPowerSource" IN ('manual', 'garmin')),
  ADD CONSTRAINT "UserProfile_intensityBasis_check"
    CHECK ("intensityBasis" IN ('hr', 'power', 'auto'));
