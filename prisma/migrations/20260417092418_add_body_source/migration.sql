-- AlterTable: M4-7 체성분 소스 필드
ALTER TABLE "BodyComposition" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'garmin';
