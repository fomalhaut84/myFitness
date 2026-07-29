-- #269: 활동 시점 기상 정보 저장.
-- 손목 측정 온도 (Garmin) 와 외부 기상 실측치 (Open-Meteo) 를 분리 저장.
-- 모두 nullable — 기존 record 는 null (backfill 스크립트로 후처리).

ALTER TABLE "Activity"
  ADD COLUMN "wristTempMaxC"        DOUBLE PRECISION,
  ADD COLUMN "wristTempMinC"        DOUBLE PRECISION,
  ADD COLUMN "weatherTempC"         DOUBLE PRECISION,
  ADD COLUMN "weatherApparentTempC" DOUBLE PRECISION,
  ADD COLUMN "weatherHumidityPct"   INTEGER,
  ADD COLUMN "weatherWindMs"        DOUBLE PRECISION,
  ADD COLUMN "weatherPrecipMm"      DOUBLE PRECISION,
  ADD COLUMN "weatherCode"          INTEGER,
  ADD COLUMN "weatherFetchedAt"     TIMESTAMP(3),
  ADD COLUMN "weatherSource"        TEXT;
