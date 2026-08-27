-- #338: SleepRecord 수면 중 최저/최고 SpO2 저장.
-- Garmin dailySleepDTO 의 lowestSpO2Value / highestSpO2Value 대응.
-- Additive nullable — 기존 행 영향 없음.
ALTER TABLE "SleepRecord" ADD COLUMN "lowestSpO2" DOUBLE PRECISION;
ALTER TABLE "SleepRecord" ADD COLUMN "highestSpO2" DOUBLE PRECISION;
