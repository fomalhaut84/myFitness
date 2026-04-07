-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "aerobicTE" DOUBLE PRECISION,
ADD COLUMN     "anaerobicTE" DOUBLE PRECISION,
ADD COLUMN     "avgCadence" INTEGER,
ADD COLUMN     "avgGroundContactTime" DOUBLE PRECISION,
ADD COLUMN     "avgRespirationRate" DOUBLE PRECISION,
ADD COLUMN     "avgStrideLength" DOUBLE PRECISION,
ADD COLUMN     "avgVerticalOscillation" DOUBLE PRECISION,
ADD COLUMN     "lapCount" INTEGER,
ADD COLUMN     "splitSummaries" JSONB;

-- AlterTable
ALTER TABLE "DailySummary" ADD COLUMN     "avgRespiration" DOUBLE PRECISION,
ADD COLUMN     "avgSpo2" DOUBLE PRECISION,
ADD COLUMN     "bodyBatteryCharged" INTEGER,
ADD COLUMN     "bodyBatteryDrained" INTEGER,
ADD COLUMN     "lowestSpo2" DOUBLE PRECISION,
ADD COLUMN     "stressHighDuration" INTEGER,
ADD COLUMN     "stressLowDuration" INTEGER,
ADD COLUMN     "stressMediumDuration" INTEGER;

-- AlterTable
ALTER TABLE "SleepRecord" ADD COLUMN     "avgRespiration" DOUBLE PRECISION,
ADD COLUMN     "avgSleepStress" DOUBLE PRECISION,
ADD COLUMN     "bodyBatteryChange" INTEGER,
ADD COLUMN     "highestRespiration" DOUBLE PRECISION,
ADD COLUMN     "hrvOvernight" DOUBLE PRECISION,
ADD COLUMN     "lowestRespiration" DOUBLE PRECISION,
ADD COLUMN     "restingHR" INTEGER,
ADD COLUMN     "sleepScoreDetails" JSONB;
