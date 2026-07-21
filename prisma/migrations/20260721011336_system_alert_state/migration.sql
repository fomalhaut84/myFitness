-- #253: 관리자 alert rate-limit persistent 상태.
-- alertType 별 단일 row upsert. pm2 restart 후에도 lastAlertAt 유지.

CREATE TABLE "SystemAlertState" (
  "id"           TEXT NOT NULL,
  "alertType"    TEXT NOT NULL,
  "lastAlertAt"  TIMESTAMP(3) NOT NULL,
  "lastErrorMsg" TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SystemAlertState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemAlertState_alertType_key"
  ON "SystemAlertState"("alertType");
