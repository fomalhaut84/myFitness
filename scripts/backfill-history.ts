/**
 * #377 F5: Garmin 과거 데이터 backfill.
 *
 *   npm run backfill:history -- --from=2019-06-01 [--to=YYYY-MM-DD] [--types=activities,sleep]
 *
 * - 청크 365일, **최신 → 과거** 순. #220 의 SyncMetadata 병합 규칙이 "인접/중첩만 병합" 이라
 *   첫 청크의 endDate 를 현재 oldestFetchedDate-1 에 붙여야 oldestFetchedDate 가 과거로 당겨지고
 *   다음 청크가 다시 인접이 된다. 과거→최신 순이면 마지막 청크만 병합돼 마커가 틀린다.
 * - --to 생략 시 선택 타입들의 oldestFetchedDate 중 **가장 늦은 값** - 1일 (없으면 어제).
 *   병합 조건이 endDate >= oldestFetchedDate-1 이라 늦은 마커 기준이어야 전 타입이 인접/중첩 (사전 리뷰 M1).
 * - `lastSyncDate` 는 backfill 대상이 아니다. syncAll 이 lastSyncDate=endDate 로 덮어쓰므로 청크마다
 *   실행 전 스냅샷으로 되돌린다 (더 늦은 값이 이미 있으면 유지). 안 그러면 weekly-report 의
 *   startDate 없는 syncAll 이 lastSyncDate+1 부터 수년치를 다시 싱크한다 (사전 리뷰 C1).
 * - 청크 실패 시 1회 재시도 후 다음 청크. 종료 시 실패 청크 목록 출력 → --from/--to 로 재실행.
 * - user_profile 은 스냅샷이라 제외.
 * - 일별 엔드포인트(daily_stats/sleep/heart_rate)는 하루 3콜 × 2초 → 약 37분/년.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { getGarminClient, resetClient } from "../src/lib/garmin/client";
import { syncAll, type DataType, type SyncResult } from "../src/lib/garmin/sync";
import { ymdKST, todayKST } from "../src/lib/garmin/utils";
import {
  buildBackfillChunks,
  pickBackfillTo,
  resolveRestoredLastSyncDate,
  type BackfillChunk,
} from "../src/lib/garmin/backfill-chunks";

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

/** 선택 타입의 oldestFetchedDate 중 가장 늦은 값 - 1일 (M1). 없으면 어제. 타입별로 다르면 경고. */
async function defaultTo(types: readonly DataType[]): Promise<Date> {
  const metas = await prisma.syncMetadata.findMany({
    where: { dataType: { in: [...types] } },
    select: { dataType: true, oldestFetchedDate: true },
  });
  const distinct = new Set(metas.map((m) => (m.oldestFetchedDate ? ymdKST(m.oldestFetchedDate) : "null")));
  if (distinct.size > 1) {
    console.warn(
      `oldestFetchedDate 가 타입별로 다릅니다 (${metas.map((m) => `${m.dataType}=${m.oldestFetchedDate ? ymdKST(m.oldestFetchedDate) : "null"}`).join(", ")}). 가장 늦은 값 기준으로 --to 를 잡습니다 — 이른 타입은 일부 구간이 중복 fetch 됩니다.`,
    );
  }
  return pickBackfillTo(metas.map((m) => m.oldestFetchedDate), todayKST());
}

type LastSyncSnapshot = ReadonlyMap<DataType, Date>;

async function snapshotLastSync(types: readonly DataType[]): Promise<LastSyncSnapshot> {
  const metas = await prisma.syncMetadata.findMany({
    where: { dataType: { in: [...types] } },
    select: { dataType: true, lastSyncDate: true },
  });
  return new Map(metas.map((m) => [m.dataType as DataType, m.lastSyncDate]));
}

/** C1: 청크가 끌어내린 lastSyncDate 를 스냅샷(또는 그 사이 cron 이 쓴 더 늦은 값)으로 복원. */
async function restoreLastSync(snapshot: LastSyncSnapshot): Promise<void> {
  for (const [dataType, before] of snapshot) {
    const meta = await prisma.syncMetadata.findUnique({
      where: { dataType },
      select: { lastSyncDate: true },
    });
    if (!meta) continue;
    const restored = resolveRestoredLastSyncDate(before, meta.lastSyncDate);
    if (restored.getTime() === meta.lastSyncDate.getTime()) continue;
    // 조건부 갱신: 그 사이 더 늦은 값이 쓰였으면 건드리지 않는다 (atomic).
    await prisma.syncMetadata.updateMany({
      where: { dataType, lastSyncDate: { lt: restored } },
      data: { lastSyncDate: restored },
    });
  }
}

function failedTypes(results: readonly SyncResult[]): DataType[] {
  return results.filter((r) => r.error).map((r) => r.dataType);
}

async function runChunk(
  chunk: Chunk,
  types: readonly DataType[],
  snapshot: LastSyncSnapshot,
): Promise<DataType[]> {
  const label = `[chunk ${chunk.index}] ${ymdKST(chunk.start)} ~ ${ymdKST(chunk.end)}`;
  const started = Date.now();
  console.log(`\n${label} 시작 (${types.join(", ")})`);
  let synced = 0;
  let failed: DataType[];
  try {
    const first = await syncAll({ startDate: chunk.start, endDate: chunk.end, dataTypes: [...types] });
    synced += first.reduce((s, r) => s + r.synced, 0);
    failed = failedTypes(first);
    if (failed.length > 0) {
      console.warn(`${label} 실패 타입 재시도: ${failed.join(", ")}`);
      const retry = await syncAll({ startDate: chunk.start, endDate: chunk.end, dataTypes: failed });
      synced += retry.reduce((s, r) => s + r.synced, 0);
      failed = failedTypes(retry);
    }
  } finally {
    // C1: 청크가 성공/실패/중단되든 lastSyncDate 는 뒤로 끌리지 않게 매 청크 복원.
    await restoreLastSync(snapshot);
  }
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

  const snapshot = await snapshotLastSync(types);
  console.log(
    `lastSyncDate 스냅샷 (backfill 후 복원): ${[...snapshot].map(([t, d]) => `${t}=${ymdKST(d)}`).join(", ") || "(없음)"}`,
  );

  const failures: { chunk: Chunk; types: DataType[] }[] = [];
  for (const chunk of chunks) {
    const failed = await runChunk(chunk, types, snapshot);
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
    select: { dataType: true, oldestFetchedDate: true, coveredThroughDate: true, lastSyncDate: true },
  });
  for (const m of metas) {
    console.log(
      `${m.dataType}: oldestFetched=${m.oldestFetchedDate ? ymdKST(m.oldestFetchedDate) : "null"} coveredThrough=${m.coveredThroughDate ? ymdKST(m.coveredThroughDate) : "null"} lastSyncDate=${ymdKST(m.lastSyncDate)}`,
    );
  }
  return failures.length === 0 ? 0 : 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("backfill 실패:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    resetClient();
    await prisma.$disconnect();
  });
