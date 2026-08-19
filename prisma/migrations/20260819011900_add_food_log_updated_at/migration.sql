-- #309 Codex P2 (PR #313 12회차): row revision snapshot 매칭용 updatedAt.
-- 기존 rows 는 CURRENT_TIMESTAMP 로 초기화 (createdAt 유지). 이후 update 마다 Prisma
-- @updatedAt 이 자동 갱신.
ALTER TABLE "FoodLog"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
