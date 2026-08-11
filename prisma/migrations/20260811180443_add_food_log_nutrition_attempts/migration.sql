-- Codex P2 (PR #300, #299 후속): 매크로 backfill starvation 방지.
-- 매크로가 permanent-null 인 log 는 attempts >= MAX 이후 재추정 스킵.
-- weatherAttempts (#269) 패턴 재사용.

ALTER TABLE "FoodLog"
  ADD COLUMN "nutritionAttempts" INTEGER;
