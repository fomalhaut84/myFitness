-- #544 (M18-3): 복약 기간 (신규 테이블 1 — 기존 데이터 영향 없음)

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "regimen" TEXT NOT NULL,
    "ingredient" TEXT,
    "dose" TEXT,
    "frequency" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "purpose" TEXT,
    "prescriber" TEXT,
    "note" TEXT,
    "relatedItems" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Medication_startDate_idx" ON "Medication"("startDate");

-- 값 제약 (Prisma 미추적 — memory: source 컬럼 CHECK 패턴). 새 값은 migration 에서 제약 교체.
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_kind_check" CHECK ("kind" IN ('prescription', 'supplement'));
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_regimen_check" CHECK ("regimen" IN ('long_term', 'short_term'));
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_period_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
-- 단기 복용은 종료일 필수 (스펙 §2-2)
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_short_term_end_check" CHECK ("regimen" <> 'short_term' OR "endDate" IS NOT NULL);
