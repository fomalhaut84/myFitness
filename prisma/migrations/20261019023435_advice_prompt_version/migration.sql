-- #552 (M19-2): AI 결과에 프롬프트 버전 연결 (nullable 2 · 기존 행은 null — 버전 정보 없음)
-- AlterTable
ALTER TABLE "AIAdvice" ADD COLUMN     "promptVersionId" TEXT,
ADD COLUMN     "systemPromptVersionId" TEXT;

-- CreateIndex
CREATE INDEX "AIAdvice_systemPromptVersionId_idx" ON "AIAdvice"("systemPromptVersionId");

-- CreateIndex
CREATE INDEX "AIAdvice_promptVersionId_idx" ON "AIAdvice"("promptVersionId");

-- AddForeignKey
ALTER TABLE "AIAdvice" ADD CONSTRAINT "AIAdvice_systemPromptVersionId_fkey" FOREIGN KEY ("systemPromptVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAdvice" ADD CONSTRAINT "AIAdvice_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

