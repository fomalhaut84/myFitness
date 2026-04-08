-- AlterTable
ALTER TABLE "AIAdvice" ADD COLUMN     "reportDate" TEXT;

-- CreateIndex
CREATE INDEX "AIAdvice_reportDate_idx" ON "AIAdvice"("reportDate");
