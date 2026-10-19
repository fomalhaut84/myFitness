-- #552 (M19-3): AI 개선안 · 시험 실행 job (신규 테이블 1 — 기존 데이터 영향 없음)
-- CreateTable
CREATE TABLE "PromptRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "targetKind" TEXT,
    "targetRef" TEXT,
    "status" TEXT NOT NULL,
    "response" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PromptRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptRun_versionId_kind_idx" ON "PromptRun"("versionId", "kind");

-- AddForeignKey
ALTER TABLE "PromptRun" ADD CONSTRAINT "PromptRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PromptVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 실행 중은 전체 1건 — 개선안 · 시험 모두 Claude CLI 쿼터를 쓴다. 동시 요청은 P2002 → API 409 (Prisma 미추적)
CREATE UNIQUE INDEX "PromptRun_running_unique" ON "PromptRun"((true)) WHERE "status" = 'running';

-- 값 제약 (Prisma 미추적 — memory: source 컬럼 CHECK 패턴)
ALTER TABLE "PromptRun" ADD CONSTRAINT "PromptRun_kind_check" CHECK ("kind" IN ('suggest', 'trial'));
ALTER TABLE "PromptRun" ADD CONSTRAINT "PromptRun_status_check" CHECK ("status" IN ('running', 'done', 'failed'));
ALTER TABLE "PromptRun" ADD CONSTRAINT "PromptRun_target_check" CHECK (
  ("kind" = 'suggest' AND "targetKind" IS NULL AND "targetRef" IS NULL)
  OR ("kind" = 'trial' AND "targetKind" IN ('report', 'activity') AND "targetRef" IS NOT NULL)
);
-- 끝난 실행은 완료 시각 필수
ALTER TABLE "PromptRun" ADD CONSTRAINT "PromptRun_completed_check" CHECK ("status" = 'running' OR "completedAt" IS NOT NULL);
