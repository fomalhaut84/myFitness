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
import { enrichActivityWeather } from "../src/lib/weather/enrich";
import { getActivityStartUtc } from "../src/lib/weather/open-meteo";

const SLEEP_MS = 200;

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? "";
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  const rows = await prisma.activity.findMany({
    // Codex P2 후속 (#269): activityType 필터 제거 — cycling/hiking 등 GPS 있는 non-running
    // 활동도 sync 경로에서 weather 를 안 채우므로 backfill 이 유일한 경로.
    where: {
      weatherFetchedAt: null,
    },
    // Codex P2 (#269): asc 로 오래된 활동부터 처리. desc 는 최근 실패 (예: archive 지연) 가
    // --limit 배치를 매번 차지해 오래된 활동이 영영 도달하지 못하는 starvation 유발.
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      name: true,
      startTime: true,
      duration: true,
      rawData: true,
      activityType: true,
    },
    // Codex P2 (#269): --skip N 으로 앞쪽 permanent 실패 건너뛰기 지원.
    ...(skip > 0 ? { skip } : {}),
    ...(limit !== undefined ? { take: limit } : {}),
  });

  console.log(
    `backfill-weather: 대상 ${rows.length} 건${skip > 0 ? ` (skip ${skip})` : ""}${limit !== undefined ? ` (limit ${limit})` : ""}${dryRun ? " [dry-run]" : ""}`,
  );

  if (dryRun) {
    for (const r of rows.slice(0, 10)) {
      console.log(`  · ${r.startTime.toISOString()} ${r.activityType} "${r.name}"`);
    }
    if (rows.length > 10) console.log(`  ... 외 ${rows.length - 10} 건`);
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const res = await enrichActivityWeather({
        activityId: r.id,
        rawData: r.rawData,
        // Codex P2 (#269): DB.startTime 은 KST 하드코딩. 국외 활동 대응 위해 rawData.startTimeGMT 우선.
        startTime: getActivityStartUtc(r.rawData, r.startTime),
        duration: r.duration,
      });
      if (res.weatherFetched) ok++;
      else if (res.weatherSkipped) skipped++;
      else failed++;
    } catch (err) {
      failed++;
      console.warn(
        `  ! ${r.startTime.toISOString()} activity ${r.id} 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if ((i + 1) % 20 === 0 || i === rows.length - 1) {
      console.log(
        `  진행 ${i + 1}/${rows.length} — 성공 ${ok}, 스킵 ${skipped}, 실패 ${failed}`,
      );
    }
    await sleep(SLEEP_MS);
  }

  console.log(
    `완료: 성공 ${ok}, 스킵 ${skipped} (GPS 없음/이미 fetched), 실패 ${failed}`,
  );
}

main()
  .catch((err) => {
    console.error("backfill 실패:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
