-- M#191 P2#1: 같은 (category, reportDate) 로 pending/running 인 job 은 1건만 허용.
-- createOrGetReportJob 의 findFirst → create race 를 DB 레벨에서 차단.
-- completed/failed 는 상태 종료이므로 unique 대상 X (partial index).
CREATE UNIQUE INDEX "ReportJob_active_unique"
  ON "ReportJob"("category", "reportDate")
  WHERE status IN ('pending', 'running');
