-- AlterTable: M4-7 체성분 소스 필드
ALTER TABLE "BodyComposition" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'garmin';

-- source 값은 'garmin' 또는 'manual'만 허용
ALTER TABLE "BodyComposition" ADD CONSTRAINT "BodyComposition_source_check" CHECK ("source" IN ('garmin', 'manual'));
