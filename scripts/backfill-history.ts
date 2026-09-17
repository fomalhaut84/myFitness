/**
 * #377 F5: Garmin 과거 데이터 backfill.
 *
 *   npm run backfill:history -- --from=2019-06-01 [--to=YYYY-MM-DD] [--types=activities,sleep]
 *
 * - 청크 365일, **최신 → 과거** 순. #220 의 SyncMetadata 병합 규칙이 "인접/중첩만 병합" 이라
 *   첫 청크의 endDate 를 현재 oldestFetchedDate-1 에 붙여야 oldestFetchedDate 가 과거로 당겨지고
 *   다음 청크가 다시 인접이 된다. 과거→최신 순이면 마지막 청크만 병합돼 마커가 틀린다.
 * - --to 생략 시 선택 타입들의 oldestFetchedDate 중 가장 이른 값 - 1일 (없으면 어제).
 * - 청크 실패 시 1회 재시도 후 다음 청크. 종료 시 실패 청크 목록 출력 → --from/--to 로 재실행.
 * - user_profile 은 스냅샷이라 제외.
 * - 일별 엔드포인트(daily_stats/sleep/heart_rate)는 하루 3콜 × 2초 → 약 37분/년.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { getGarminClient, resetClient } from "../src/lib/garmin/client";
import { syncAll, type DataType, type SyncResult } from "../src/lib/garmin/sync";
import { ymdKST, todayKST } from "../src/lib/garmin/utils";
import { buildBackfillChunks, type BackfillChunk } from "../src/lib/garmin/backfill-chunks";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_TYPES: DataType[] = [
  "daily_stats",
  "activities",
  "sleep",
  "heart_rate",
  "body_composition",
  "blood_pressure",
];

type Chunk = BackfillChunk;

function parseKST(ymd: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`${flag}: YYYY-MM-DD 형식이어야 합니다 (받은 값: ${ymd})`);
  }
  const d = new Date(`${ymd}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime()) || ymdKST(d) !== ymd) {
    throw new Error(`${flag}: 유효하지 않은 날짜 ${ymd}`);
  }
  return d;
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function parseTypes(raw: string | undefined): DataType[] {
  if (!raw) return BACKFILL_TYPES;
  const wanted = raw.split(",").map((t) => t.trim()).filter(Boolean);
  const unknown = wanted.filter((t) => !BACKFILL_TYPES.includes(t as DataType));
  if (unknown.length > 0) {
    throw new Error(`--types: 지원하지 않는 타입 ${unknown.join(", ")} (가능: ${BACKFILL_TYPES.join(", ")})`);
  }
  return wanted as DataType[];
}

/** 선택 타입의 oldestFetchedDate 중 가장 이른 값 - 1일. 없으면 어제. */
async function defaultTo(types: readonly DataType[]): Promise<Date> {
  const metas = await prisma.syncMetadata.findMany({
    where: { dataType: { in: [...types] } },
    select: { oldestFetchedDate: true },
  });
  const oldest = metas
    .map((m) => m.oldestFetchedDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const base = oldest ?? todayKST();
  return new Date(base.getTime() - DAY_MS);
}

function failedTypes(results: readonly SyncResult[]): DataType[] {
  return results.filter((r) => r.error).map((r) => r.dataType);
}

async function runChunk(chunk: Chunk, types: readonly DataType[]): Promise<DataType[]> {
  const label = `[chunk ${chunk.index}] ${ymdKST(chunk.start)} ~ ${ymdKST(chunk.end)}`;
  const started = Date.now();
  console.log(`\n${label} 시작 (${types.join(", ")})`);
  const first = await syncAll({ startDate: chunk.start, endDate: chunk.end, dataTypes: [...types] });
  let failed = failedTypes(first);
  if (failed.length > 0) {
    console.warn(`${label} 실패 타입 재시도: ${failed.join(", ")}`);
    const retry = await syncAll({ startDate: chunk.start, endDate: chunk.end, dataTypes: failed });
    failed = failedTypes(retry);
  }
  const synced = first.reduce((s, r) => s + r.synced, 0);
  const min = Math.round((Date.now() - started) / 60000);
  console.log(`${label} 완료: ${synced}건, 실패 ${failed.length}건, ${min}분`);
  return failed;
}

async function main() {
  const args = process.argv.slice(2);
  const fromRaw = readFlag(args, "from");
  if (!fromRaw) {
    console.error("사용법: npm run backfill:history -- --from=YYYY-MM-DD [--to=YYYY-MM-DD] [--types=a,b]");
    process.exit(1);
  }
  const types = parseTypes(readFlag(args, "types"));
  const from = parseKST(fromRaw, "--from");
  const toRaw = readFlag(args, "to");
  const to = toRaw ? parseKST(toRaw, "--to") : await defaultTo(types);
  if (from > to) {
    throw new Error(`--from(${ymdKST(from)}) 이 --to(${ymdKST(to)}) 보다 늦습니다`);
  }

  const chunks = buildBackfillChunks(from, to);
  console.log(`=== Garmin backfill: ${ymdKST(from)} ~ ${ymdKST(to)} · ${chunks.length}청크 · ${types.join(", ")} ===`);
  console.log("Garmin 로그인...");
  await getGarminClient();
  console.log("로그인 성공");

  const failures: { chunk: Chunk; types: DataType[] }[] = [];
  for (const chunk of chunks) {
    const failed = await runChunk(chunk, types);
    if (failed.length > 0) failures.push({ chunk, types: failed });
  }

  console.log("\n=== 결과 ===");
  if (failures.length === 0) {
    console.log("모든 청크 성공");
  } else {
    for (const f of failures) {
      console.log(
        `실패: --from=${ymdKST(f.chunk.start)} --to=${ymdKST(f.chunk.end)} --types=${f.types.join(",")}`,
      );
    }
  }
  const metas = await prisma.syncMetadata.findMany({
    where: { dataType: { in: [...types] } },
    select: { dataType: true, oldestFetchedDate: true, coveredThroughDate: true },
  });
  for (const m of metas) {
    console.log(
      `${m.dataType}: oldestFetched=${m.oldestFetchedDate ? ymdKST(m.oldestFetchedDate) : "null"} coveredThrough=${m.coveredThroughDate ? ymdKST(m.coveredThroughDate) : "null"}`,
    );
  }
  resetClient();
  process.exit(failures.length === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error("backfill 실패:", error);
  process.exit(1);
});
