-- AlterTable: 싱글톤 sentinel 컬럼 추가 (모든 기존 row는 default true)
ALTER TABLE "UserProfile" ADD COLUMN "singleton" BOOLEAN NOT NULL DEFAULT true;

-- 싱글톤 보장: 중복 row가 존재할 경우 가장 오래된 것만 남기고 삭제.
-- unique 인덱스 생성 전에 실행해야 함 (dedupe-aware).
DELETE FROM "UserProfile"
WHERE id NOT IN (
  SELECT id FROM "UserProfile"
  ORDER BY "createdAt" ASC, id ASC
  LIMIT 1
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_singleton_key" ON "UserProfile"("singleton");
