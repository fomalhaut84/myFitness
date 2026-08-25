-- #322 (M14 Phase 3 #2): FoodLog.items — estimator 산출 item 별 분해 저장.
-- Additive nullable JSONB. legacy row 는 NULL.
ALTER TABLE "FoodLog" ADD COLUMN "items" JSONB;
