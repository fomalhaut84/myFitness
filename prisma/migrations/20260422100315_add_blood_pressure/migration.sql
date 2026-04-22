-- CreateTable: 혈압 트래킹
CREATE TABLE "BloodPressure" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "highSystolic" INTEGER NOT NULL,
    "lowSystolic" INTEGER NOT NULL,
    "highDiastolic" INTEGER NOT NULL,
    "lowDiastolic" INTEGER NOT NULL,
    "avgPulse" INTEGER,
    "measureCount" INTEGER NOT NULL DEFAULT 1,
    "category" TEXT,
    "measurements" JSONB,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BloodPressure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BloodPressure_date_key" ON "BloodPressure"("date");
