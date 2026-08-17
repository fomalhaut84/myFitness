-- #299 (M14 Phase 2 #3): P/C/F 매크로 추적 필드.
-- FoodLog 에 매크로 g (nullable — 부분 미측정 허용, kcal 방식과 동일 propagate 정책).
-- UserProfile 에 단백질 목표 g/kg (러너 권장 1.6 기본).

ALTER TABLE "FoodLog"
  ADD COLUMN "proteinG" DOUBLE PRECISION,
  ADD COLUMN "carbsG"   DOUBLE PRECISION,
  ADD COLUMN "fatG"     DOUBLE PRECISION;

ALTER TABLE "UserProfile"
  ADD COLUMN "proteinTargetPerKg" DOUBLE PRECISION DEFAULT 1.6;
