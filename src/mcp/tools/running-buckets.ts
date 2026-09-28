// #396: 본체는 `src/lib/running/buckets.ts` 로 이동 (웹 페이지가 `src/mcp/` 를 import 하지 않도록). 기존 import 경로 유지용 재-export.
export { type Bucket, bucketOf, formatPace } from "@/lib/running/buckets";
