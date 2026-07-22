-- #261: Activity.routeTag 사용자 커스텀 코스명. 같은 GPS/거리 클러스터 + 같은 태그 = 같은 코스.
-- Nullable — 기존 record 는 null (자동 GPS 매칭으로 대체).

ALTER TABLE "Activity"
  ADD COLUMN "routeTag" TEXT;

CREATE INDEX "Activity_routeTag_idx" ON "Activity"("routeTag");
