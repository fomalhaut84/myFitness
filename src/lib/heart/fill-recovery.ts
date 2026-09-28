// #425: `Activity.hrr2` · `hrrDrop10` 채움 — 서버 전용 (prisma). `syncAll` 후처리 (좁은 창) 와 `backfill:hrr` (넓은 창) 이 같은 함수를 쓴다.
// API 호출 0 — DB 의 HeartRateRecord 만 읽는다. 청크마다 필요한 일자를 모아 한 번에 읽고, 활동별로 합쳐 곡선을 만든다.
import prisma from "@/lib/prisma";
import { RUNNING_ACTIVITY_WHERE } from "@/lib/activity/running-types";
import { ymdKST } from "@/lib/garmin/utils";
import { kstInstant } from "@/lib/history/buckets";
import { mergeSeries, planChunk, recoveryPayload } from "./fill-plan";
import { parseHeartRateValues, recoveryCurve, type HrSample } from "./recovery";

export interface FillRecoveryOptions {
  /** `startTime` ∈ [from, to) */
  from: Date;
  to: Date;
  /** true 면 이미 채워진 행도 다시 계산 (기본은 `hrr2` 또는 `hrrDrop10` 이 null 인 행만) */
  force?: boolean;
  /** true 면 update 만 생략 (집계는 그대로) */
  dryRun?: boolean;
  /** 상한 (백필 분할용) */
  limit?: number;
  /** 이어가기 커서 — 이 (startTime, id) **뒤** 부터 (PR #428 Codex P2: limit 분할 실행이 매번 처음부터 돌지 않게) */
  after?: { startTime: Date; id: string };
  batchSize?: number;
  log?: (line: string) => void;
}

export interface FillRecoveryResult {
  /** 대상 러닝 수 */
  candidates: number;
  /** hrr2 를 쓴 (dryRun 이면 썼을) 수 */
  updated: number;
  /** 종료일 HeartRateRecord 없음 → null 유지 */
  missing: number;
  /** 레코드는 있으나 0 · +2 분 결측 → null 유지 (부분 데이터 · 워치 벗음) */
  skipped: number;
  /** 마지막으로 처리한 (startTime, id) — `limit` 에 걸렸으면 다음 실행의 `after` */
  lastCursor: { startTime: Date; id: string } | null;
}

const DEFAULT_BATCH = 200;

export async function fillRecoveryColumns(opts: FillRecoveryOptions): Promise<FillRecoveryResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const result: FillRecoveryResult = { candidates: 0, updated: 0, missing: 0, skipped: 0, lastCursor: null };
  let cursor: { startTime: Date; id: string } | undefined = opts.after;

  while (opts.limit === undefined || result.candidates < opts.limit) {
    const take = opts.limit === undefined ? batchSize : Math.min(batchSize, opts.limit - result.candidates);
    const rows = await prisma.activity.findMany({
      where: {
        AND: [
          RUNNING_ACTIVITY_WHERE,
          { startTime: { gte: opts.from, lt: opts.to } },
          // 사전 리뷰 info 1: 부분 싱크 (종료 2~10분 뒤) 는 hrr2 만 채우고 hrrDrop10 이 null 로 남는다 — 그 행도 다시 시도한다.
          // 영구 결측 (10분 샘플 없음) 행은 창 안에서 매번 다시 계산되지만 창이 며칠이라 비용은 미미하다
          ...(opts.force ? [] : [{ OR: [{ hrr2: null }, { hrrDrop10: null }] }]),
          // composite cursor (startTime, id) — startTime 은 unique 가 아니다 (backfill-event-type 선례)
          ...(cursor ? [{ OR: [{ startTime: { gt: cursor.startTime } }, { AND: [{ startTime: cursor.startTime }, { id: { gt: cursor.id } }] }] }] : []),
        ],
      },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take,
      select: { id: true, startTime: true, duration: true, rawData: true },
    });
    if (rows.length === 0) break;
    result.candidates += rows.length;
    cursor = { startTime: rows[rows.length - 1].startTime, id: rows[rows.length - 1].id };
    result.lastCursor = cursor;

    const plan = planChunk(rows);
    const records = await prisma.heartRateRecord.findMany({
      where: { date: { in: plan.dayKeys.map(kstInstant) } },
      select: { date: true, rawData: true },
    });
    const byDay = new Map<string, HrSample[]>(
      records.map((r) => {
        const raw = r.rawData !== null && typeof r.rawData === "object" ? (r.rawData as Record<string, unknown>).heartRateValues : undefined;
        return [ymdKST(r.date), parseHeartRateValues(raw)];
      }),
    );

    for (const item of plan.items) {
      if (!byDay.has(ymdKST(new Date(item.endMs)))) {
        result.missing++;
        continue;
      }
      const payload = recoveryPayload(recoveryCurve(mergeSeries(byDay, item.dayKeys), item.endMs));
      if (payload === null) {
        result.skipped++;
        continue;
      }
      if (!opts.dryRun) await prisma.activity.update({ where: { id: item.id }, data: payload });
      result.updated++;
    }
    opts.log?.(`[hrr] ${result.candidates}건 처리 — 갱신 ${result.updated} · 레코드 없음 ${result.missing} · 결측 ${result.skipped}`);
    if (rows.length < take) break;
  }
  return result;
}
