-- #220: SyncMetadata.oldestFetchedDate 필드 추가.
-- 실제 fetch 커버 범위의 최초 날짜. NULL 허용 (기존 record 는 첫 성공 sync 시 firstRecordDate fallback 으로 초기화).

ALTER TABLE "SyncMetadata"
  ADD COLUMN "oldestFetchedDate" TIMESTAMP(3);
