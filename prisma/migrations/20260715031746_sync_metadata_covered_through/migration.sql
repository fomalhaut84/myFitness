-- #220 (PR #240 Codex P2 대응): coveredThroughDate 컬럼 추가.
-- 실제 fetch 커버 범위 [oldestFetchedDate, coveredThroughDate] contiguous 표현.
-- 기존 record 는 null → 다음 성공 sync 시 자동 초기화.

ALTER TABLE "SyncMetadata"
  ADD COLUMN "coveredThroughDate" TIMESTAMP(3);
