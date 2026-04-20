-- AlterTable: M4-2 칼로리 밸런스 필드
ALTER TABLE "DailySummary"
  ADD COLUMN "estimatedIntakeCalories" INTEGER,
  ADD COLUMN "availableCalories" INTEGER,
  ADD COLUMN "calorieBalance" INTEGER;
