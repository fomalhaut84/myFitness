-- AlterTable: Garmin 자동 싱크 필드
ALTER TABLE "UserProfile"
  ADD COLUMN "vo2maxRunning" DOUBLE PRECISION,
  ADD COLUMN "maxHRSource" TEXT,
  ADD COLUMN "lthrSource" TEXT,
  ADD COLUMN "lthrAutoDetected" BOOLEAN,
  ADD COLUMN "lthrMeasuredAt" TIMESTAMP(3),
  ADD COLUMN "heartRateZonesRaw" JSONB,
  ADD COLUMN "garminSyncedAt" TIMESTAMP(3);

-- 기존 사용자 데이터 보호: 마이그레이션 전 수동 입력된 maxHR/lthr/lthrPace를 'manual' 표시.
-- lthrPace만 입력한 케이스도 보호 (lthrSource를 lthrPace 기반으로도 backfill).
-- 이 백필이 없으면 source=NULL 상태에서 첫 Garmin 싱크가 수동 입력값을 덮어씀.
UPDATE "UserProfile" SET "maxHRSource" = 'manual' WHERE "maxHR" IS NOT NULL;
UPDATE "UserProfile" SET "lthrSource" = 'manual' WHERE "lthr" IS NOT NULL OR "lthrPace" IS NOT NULL;

-- source 값 제약
ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_maxHRSource_check"
    CHECK ("maxHRSource" IS NULL OR "maxHRSource" IN ('manual', 'garmin')),
  ADD CONSTRAINT "UserProfile_lthrSource_check"
    CHECK ("lthrSource" IS NULL OR "lthrSource" IN ('manual', 'garmin'));

-- CreateTable: 메트릭 변경 이력
CREATE TABLE "MetricChange" (
    "id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" DOUBLE PRECISION,
    "newValue" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MetricChange_field_changedAt_idx" ON "MetricChange"("field", "changedAt");
CREATE INDEX "MetricChange_changedAt_idx" ON "MetricChange"("changedAt");

ALTER TABLE "MetricChange"
  ADD CONSTRAINT "MetricChange_source_check"
    CHECK ("source" IN ('manual', 'garmin'));
