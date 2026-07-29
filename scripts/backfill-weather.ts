/**
 * #269: 기존 Activity 에 대해 손목 온도 + 외부 기상 필드 backfill.
 *
 * 실행: npx tsx scripts/backfill-weather.ts [--limit N] [--dry-run]
 *
 * 조건:
 *  - weatherFetchedAt IS NULL (아직 시도 안 했거나 이전 시도 실패)
 *  - running-family (activityType contains "running" or virtual_run/obstacle_run)
 *
 * 정책:
 *  - GPS 없는 실내 활동: 손목 온도만 반영, weatherFetchedAt 은 갱신 안 함
 *  - API 실패: 다음 실행에서 재시도되도록 weatherFetchedAt 유지 null
 *  - Rate limit: per-activity 200ms sleep
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

async function main() {
  const limitArg = parseArg("--limit");
  const limit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : undefined;
  const dryRun = hasFlag("--dry-run");

  const rows = await prisma.activity.findMany({
    where: {
      weatherFetchedAt: null,
      OR: [
        { activityType: { contains: "running" } },
        { activityType: { in: ["virtual_run", "obstacle_run"] } },
      ],
    },
    orderBy: { startTime: "desc" },
    select: {
      id: true,
      name: true,
      startTime: true,
      duration: true,
      rawData: true,
      activityType: true,
    },
    ...(limit ? { take: limit } : {}),
  });

  console.log(
    `backfill-weather: 대상 ${rows.length} 건${limit ? ` (limit ${limit})` : ""}${dryRun ? " [dry-run]" : ""}`,
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
