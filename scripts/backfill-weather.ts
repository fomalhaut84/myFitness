/**
 * #269: 기존 Activity 에 대해 손목 온도 + 외부 기상 필드 backfill.
 *
 * 실행: npx tsx scripts/backfill-weather.ts [--limit N] [--skip N] [--dry-run]
 *
 * 조건:
 *  - weatherFetchedAt IS NULL (아직 시도 안 했거나 이전 시도 실패)
 *  - 모든 activityType — running/cycling/hiking 등 GPS 있는 모든 활동 대상. 실내는
 *    첫 시도에 no-gps sentinel 저장으로 이후 스킵 (Codex P2 후속 #269).
 *
 * 정책:
 *  - GPS 없는 실내 활동: 손목 온도만 반영, weatherFetchedAt 은 갱신 안 함
 *  - API 실패: 다음 실행에서 재시도되도록 weatherFetchedAt 유지 null
 *  - Rate limit: per-activity 200ms sleep
 *
 * 옵션:
 *  --limit N   1회 실행 처리 상한 (positive integer). 미지정 시 전량.
 *  --skip N    처음 N 건 건너뛰기 (permanent 실패 뒤로 넘어갈 때 사용).
 *  --dry-run   대상만 출력, 실제 fetch/update 없음.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { runWeatherBackfill } from "../src/lib/weather/enrich";

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? "";
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/** positive integer (>=1) 파싱. 잘못된 값이면 즉시 에러로 종료 — 의도치 않은 전량 처리 방지. */
function parsePositiveInt(raw: string | null, argName: string): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`${argName} 은 1 이상의 정수여야 합니다 (got: "${raw}")`);
  }
  return n;
}

/** --skip 은 0 이상 정수 허용. */
function parseNonNegInt(raw: string | null, argName: string): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`${argName} 은 0 이상의 정수여야 합니다 (got: "${raw}")`);
  }
  return n;
}

async function main() {
  // Codex P2 (#269): 부적절한 --limit 값 (typo 등) 이 NaN 으로 falsy 되어 전량 실행되지
  // 않도록 검증. 부정확한 인자면 즉시 에러로 종료.
  const limit = parsePositiveInt(parseArg("--limit"), "--limit");
  const skip = parseNonNegInt(parseArg("--skip"), "--skip") ?? 0;
  const dryRun = hasFlag("--dry-run");

  const result = await runWeatherBackfill({
    limit,
    skip,
    dryRun,
    verbose: true,
  });

  const status = dryRun ? " [dry-run]" : "";
  console.log(
    `backfill-weather: 대상 ${result.candidates} 건${skip > 0 ? ` (skip ${skip})` : ""}${limit !== undefined ? ` (limit ${limit})` : ""}${status}`,
  );
  if (!dryRun) {
    console.log(
      `완료: 성공 ${result.ok}, 스킵 ${result.skipped} (GPS 없음/이미 fetched), 실패 ${result.failed}`,
    );
  }
}

main()
  .catch((err) => {
    console.error("backfill 실패:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
