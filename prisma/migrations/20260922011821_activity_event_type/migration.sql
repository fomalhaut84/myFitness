-- #396: Activity.eventType — Garmin eventType.typeKey ("race" · "training" · "uncategorized" …) 컬럼 승격.
-- Nullable · additive. 기존 행은 backfill:event-type 이 rawData 에서 채운다 (API 호출 0).

ALTER TABLE "Activity"
  ADD COLUMN "eventType" TEXT;

CREATE INDEX "Activity_eventType_startTime_idx" ON "Activity"("eventType", "startTime");
