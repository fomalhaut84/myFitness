-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "weeklyFrequency" INTEGER NOT NULL,
    "targetDistance" TEXT,
    "targetDate" DATE,
    "baselineWeeklyKm" DOUBLE PRECISION,
    "baselineAcwr" DOUBLE PRECISION,
    "lthrPaceUsed" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingWorkout" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "paceSecPerKm" INTEGER,
    "zone" TEXT,
    "intervalDesc" TEXT,
    "notes" TEXT,

    CONSTRAINT "TrainingWorkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingPlan_status_createdAt_idx" ON "TrainingPlan"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingWorkout_date_idx" ON "TrainingWorkout"("date");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingWorkout_planId_date_key" ON "TrainingWorkout"("planId", "date");

-- AddForeignKey
ALTER TABLE "TrainingWorkout" ADD CONSTRAINT "TrainingWorkout_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
