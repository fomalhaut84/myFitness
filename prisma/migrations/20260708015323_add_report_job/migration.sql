-- CreateTable
CREATE TABLE "ReportJob" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "force" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "adviceId" TEXT,

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportJob_category_reportDate_status_idx" ON "ReportJob"("category", "reportDate", "status");

-- CreateIndex
CREATE INDEX "ReportJob_status_startedAt_idx" ON "ReportJob"("status", "startedAt");
