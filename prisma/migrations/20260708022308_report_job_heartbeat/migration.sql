-- M#191 P2#5: heartbeat 기반 orphan sweep. runner 가 30s 마다 touch → sweeper 는
-- updatedAt 기준으로 판정 → 정상 실행 job 은 안전, orphan 만 감지.

-- DropIndex
DROP INDEX "ReportJob_status_startedAt_idx";

-- AlterTable: DEFAULT CURRENT_TIMESTAMP 로 기존 row 안전 백필.
ALTER TABLE "ReportJob" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ReportJob_status_updatedAt_idx" ON "ReportJob"("status", "updatedAt");
