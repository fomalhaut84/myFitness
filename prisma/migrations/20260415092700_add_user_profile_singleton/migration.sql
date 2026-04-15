-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN "singleton" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_singleton_key" ON "UserProfile"("singleton");
