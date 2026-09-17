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
 *   SyncMetadata 행이 없는(또는 성공 싱크가 없는) 타입은 `to` 를 복원 기준으로 쓴다 (Codex P1 PR #379).
 * - 청크 실패 시 1회 재시도. 그래도 실패한 타입은 **그 타입만 이후(더 오래된) 청크에서 멈춘다** —
 *   커버 범위에 구멍이 나면 아래 청크의 마커는 disjoint 로 무시돼 복구 불가 (Codex P2 PR #379).
 *   종료 시 `--from=<from> --to=<실패 청크 end> --types=<타입>` 재개 명령 출력.
 * - SIGINT/SIGTERM 은 **진행 중인 청크가 끝난 뒤**(그 finally 가 복원) 종료한다 — 시그널 종료는 JS finally 를
 *   타지 않고, 진행 중 syncAll 과 동시에 복원하면 in-flight updateSyncMetadata 가 나중에 덮어쓴다 (Codex P2 ×2).
 *   두 번째 시그널은 즉시 강제 종료 (lastSyncDate 가 stale 할 수 있음 — 경고 출력).
 * - 행 없음/성공 싱크 없음 타입의 fallback(`to`) 복원은 그 타입이 한 번이라도 성공한 뒤에만 (Codex P2 3회차).
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
  buildLastSyncSnapshot,
  pickBackfillTo,
  resolveRestoredLastSyncDate,
  restorableTypes,
  stopFailedTypes,
  typesWithoutSuccessfulSync,
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

interface RunState {
  snapshot: LastSyncSnapshot;
  /** 스냅샷이 fallback(`to`) 인 타입 — 성공 전엔 복원하지 않는다 */
  fallbackTypes: ReadonlySet<DataType>;
  /** 이번 실행에서 한 번이라도 성공한 타입 (새 Set 으로 교체, 불변) */
  succeeded: ReadonlySet<DataType>;
}

/** 시그널 핸들러가 기다릴 진행 중 청크 (runChunk 의 finally 가 복원까지 마친다). */
let activeChunk: Promise<unknown> | null = null;
let shutdownRequested = false;

/**
 * Codex P2: 시그널 종료는 finally 를 타지 않는다. 진행 중 syncAll 과 동시에 복원하면 복원이 먼저 끝나고
 * in-flight updateSyncMetadata 가 stale 값을 다시 쓰므로, 진행 중 청크를 **기다린 뒤** 종료한다.
 */
function installSignalHandlers(): void {
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    process.on(signal, () => {
      if (shutdownRequested) {
        console.error(
          `\n${signal} 재수신 — 즉시 종료합니다. 진행 중 청크의 lastSyncDate 가 stale 할 수 있으니 psql 로 확인하세요:` +
            ` select "dataType","lastSyncDate" from "SyncMetadata";`,
        );
        process.exit(code);
      }
      shutdownRequested = true;
      console.warn(`\n${signal} 수신 — 진행 중 청크가 끝나면 (복원 포함) 종료합니다. 한 번 더 보내면 즉시 종료.`);
      (activeChunk ?? Promise.resolve())
        .catch(() => {})
        .finally(async () => {
          await prisma.$disconnect().catch(() => {});
          process.exit(code);
        });
    });
  }
}

/** 행이 없거나 성공 싱크가 없는 타입은 `to` (backfill 후 증분 경계) 를 기준으로 (Codex P1). */
async function snapshotLastSync(types: readonly DataType[], to: Date): Promise<RunState> {
  const metas = await prisma.syncMetadata.findMany({
    where: { dataType: { in: [...types] } },
    select: { dataType: true, lastSyncDate: true },
  });
  return {
    snapshot: buildLastSyncSnapshot(types, metas, to),
    fallbackTypes: typesWithoutSuccessfulSync(types, metas),
    succeeded: new Set(),
  };
}

/**
 * C1: 청크가 끌어내린 lastSyncDate 를 스냅샷(또는 그 사이 cron 이 쓴 더 늦은 값)으로 복원.
 * fallback 타입은 성공 후에만 (Codex P2 3회차).
 */
async function restoreLastSync(state: RunState): Promise<void> {
  const targets = restorableTypes([...state.snapshot.keys()], state.fallbackTypes, state.succeeded);
  for (const dataType of targets) {
    const before = state.snapshot.get(dataType)!;
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

/** 청크 실행. 반환: 실패 타입 + 갱신된 succeeded (불변). */
async function runChunk(
  chunk: Chunk,
  types: readonly DataType[],
  state: RunState,
): Promise<{ failed: DataType[]; state: RunState }> {
  const label = `[chunk ${chunk.index}] ${ymdKST(chunk.start)} ~ ${ymdKST(chunk.end)}`;
  const started = Date.now();
  console.log(`\n${label} 시작 (${types.join(", ")})`);
  let synced = 0;
  let failed: DataType[] = [...types];
  let nextState = state;
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
    const failedSet = new Set(failed);
    nextState = {
      ...state,
      succeeded: new Set([...state.succeeded, ...types.filter((t) => !failedSet.has(t))]),
    };
  } finally {
    // C1: 청크가 성공/실패/중단되든 lastSyncDate 는 뒤로 끌리지 않게 매 청크 복원.
    await restoreLastSync(nextState);
  }
  const min = Math.round((Date.now() - started) / 60000);
  console.log(`${label} 완료: ${synced}건, 실패 ${failed.length}건, ${min}분`);
  return { failed, state: nextState };
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

  let state = await snapshotLastSync(types, to);
  installSignalHandlers();
  console.log(
    `lastSyncDate 스냅샷 (backfill 후 복원 기준): ${[...state.snapshot].map(([t, d]) => `${t}=${ymdKST(d)}${state.fallbackTypes.has(t) ? "(fallback)" : ""}`).join(", ")}`,
  );

  // Codex P2: 실패한 타입은 그 청크에서 멈춘다. 재개 명령은 from ~ 실패 청크 end 전체.
  const stopped: { chunk: Chunk; types: DataType[] }[] = [];
  let active: DataType[] = [...types];
  for (const chunk of chunks) {
    if (shutdownRequested) break;
    if (active.length === 0) {
      console.log(`[chunk ${chunk.index}] 남은 활성 타입 없음 — 중단`);
      break;
    }
    const running = runChunk(chunk, active, state);
    activeChunk = running;
    const result = await running;
    activeChunk = null;
    state = result.state;
    const failed = result.failed;
    if (failed.length > 0) {
      stopped.push({ chunk, types: failed });
      active = stopFailedTypes(active, failed);
      console.warn(`[chunk ${chunk.index}] ${failed.join(", ")} 은(는) 여기서 멈춤 (더 오래된 청크 건너뜀)`);
    }
  }

  console.log("\n=== 결과 ===");
  if (stopped.length === 0) {
    console.log("모든 청크 성공");
  } else {
    console.log("실패한 타입은 실패 청크부터 --from 까지 다시 돌려야 커버 범위가 이어집니다:");
    for (const f of stopped) {
      console.log(
        `재개: npm run backfill:history -- --from=${ymdKST(from)} --to=${ymdKST(f.chunk.end)} --types=${f.types.join(",")}`,
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
  return stopped.length === 0 ? 0 : 2;
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
