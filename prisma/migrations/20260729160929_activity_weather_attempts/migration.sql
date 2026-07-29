-- #269 후속: weather backfill 스타베이션 방지 — 실패 (transient) 누적 카운터.
-- backfill 러너는 이 컬럼 값 오름차순으로 처리해 오래된 실패가 새 활동을 무한 차단하지 않도록 로테이션.
-- MAX_ATTEMPTS 초과 시 sentinel (weatherSource = "failed:attempts-exceeded") 저장 후 재시도 중단.

ALTER TABLE "Activity"
  ADD COLUMN "weatherAttempts" INTEGER;
