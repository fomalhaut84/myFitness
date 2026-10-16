-- #527 (M18-1): 건강검진 회차 · 항목 결과 (신규 테이블 2 — 기존 데이터 영향 없음)

-- CreateTable
CREATE TABLE "HealthCheckup" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "institution" TEXT,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "summary" TEXT,
    "findings" JSONB,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthCheckup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckupResult" (
    "id" TEXT NOT NULL,
    "checkupId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "valueNum" DOUBLE PRECISION,
    "valueText" TEXT,
    "unit" TEXT,
    "refText" TEXT,
    "refLow" DOUBLE PRECISION,
    "refHigh" DOUBLE PRECISION,
    "flag" TEXT,
    "flagSource" TEXT,
    "note" TEXT,
    "followUp" TEXT,
    "followUpDue" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckupResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HealthCheckup_date_key" ON "HealthCheckup"("date");

-- CreateIndex
CREATE INDEX "CheckupResult_itemCode_idx" ON "CheckupResult"("itemCode");

-- CreateIndex
CREATE INDEX "CheckupResult_followUpDue_idx" ON "CheckupResult"("followUpDue");

-- CreateIndex
CREATE UNIQUE INDEX "CheckupResult_checkupId_itemCode_key" ON "CheckupResult"("checkupId", "itemCode");

-- AddForeignKey
ALTER TABLE "CheckupResult" ADD CONSTRAINT "CheckupResult_checkupId_fkey" FOREIGN KEY ("checkupId") REFERENCES "HealthCheckup"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 값 제약 (Prisma 미추적 — memory: source 컬럼 CHECK 패턴). 새 값은 migration 에서 제약 교체.
ALTER TABLE "HealthCheckup" ADD CONSTRAINT "HealthCheckup_kind_check" CHECK ("kind" IN ('national', 'comprehensive', 'other'));
ALTER TABLE "HealthCheckup" ADD CONSTRAINT "HealthCheckup_source_check" CHECK ("source" IN ('manual', 'capture', 'pdf', 'photo'));
ALTER TABLE "CheckupResult" ADD CONSTRAINT "CheckupResult_flag_check" CHECK ("flag" IS NULL OR "flag" IN ('normal', 'caution', 'abnormal'));
ALTER TABLE "CheckupResult" ADD CONSTRAINT "CheckupResult_flagSource_check" CHECK ("flagSource" IS NULL OR "flagSource" IN ('institution', 'computed'));
-- 판정과 판정 출처는 함께 있거나 함께 없다
ALTER TABLE "CheckupResult" ADD CONSTRAINT "CheckupResult_flag_pair_check" CHECK (("flag" IS NULL) = ("flagSource" IS NULL));
-- 결과 없는 행 금지 (미시행 항목은 행을 만들지 않는다)
ALTER TABLE "CheckupResult" ADD CONSTRAINT "CheckupResult_value_check" CHECK ("valueNum" IS NOT NULL OR "valueText" IS NOT NULL);
