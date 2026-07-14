-- M12 (#223): 개인 목표 필드 (평균 페이스, 주간 거리, VO2max, 커스텀 텍스트).
-- 모두 nullable — 기존 record 는 NULL 상태로 안전 백필.
ALTER TABLE "UserProfile"
  ADD COLUMN "targetAvgPace" DOUBLE PRECISION,
  ADD COLUMN "targetWeeklyKm" DOUBLE PRECISION,
  ADD COLUMN "targetVO2max" DOUBLE PRECISION,
  ADD COLUMN "personalGoalNote" TEXT;
