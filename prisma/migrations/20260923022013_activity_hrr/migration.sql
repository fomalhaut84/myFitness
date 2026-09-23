-- #425: Activity.hrr2 · hrrDrop10 — 종료 후 심박 회복 (2분 HRR · 10분 낙차) 컬럼 승격.
-- Nullable · additive · 인덱스 없음 (러닝 + startTime 필터만). 기존 행은 backfill:hrr 이 HeartRateRecord 에서 채운다 (API 호출 0).

ALTER TABLE "Activity"
  ADD COLUMN "hrr2" INTEGER,
  ADD COLUMN "hrrDrop10" INTEGER;
