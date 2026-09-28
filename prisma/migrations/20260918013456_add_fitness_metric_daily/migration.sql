-- #378: Garmin VO2max 일별 · 러닝 젖산역치(HR/속도) 감지일 이력 (fitness_metrics dataType).
-- 신규 테이블 — 기존 행 영향 없음. date 는 KST 자정 instant, 날짜당 1행 (upsert).
CREATE TABLE "FitnessMetricDaily" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vo2maxRunning" DOUBLE PRECISION,
    "lthr" INTEGER,
    "lthrPace" DOUBLE PRECISION,
    "fitnessAge" INTEGER,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitnessMetricDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FitnessMetricDaily_date_key" ON "FitnessMetricDaily"("date");
