/**
 * #425: 이미 저장된 러닝의 `hrr2` · `hrrDrop10` 을 하루치 심박 시계열 (HeartRateRecord) 에서 채운다. Garmin API 호출 0.
 *
 * 실행:
 *   npm run backfill:hrr -- [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--force] [--dry-run]
 *
 * 옵션:
 *  --from      시작일 (KST, 포함). 기본 2020-01-01 (하한 이전은 러닝이 없다)
 *  --to        종료일 (KST, 포함). 기본 오늘
 *  --limit N   대상 상한 (분할 실행)
 *  --force     이미 채워진 행도 다시 계산
 *  --dry-run   update 만 생략, 집계는 출력
 *
 * 결과 `missing` = 종료일 심박 레코드 없음 (워치 미착용일), `skipped` = 레코드는 있으나 0 · +2 분 샘플 결측 → 둘 다 null 유지.
 * 실행 후 웹 캐시 (TTL 10분) 는 별 프로세스라 갱신되지 않는다 — `pm2 restart` 또는 10분 대기.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { fillRecoveryColumns } from "../src/lib/heart/fill-recovery";
import { todayKSTString } from "../src/lib/garmin/utils";
import { isValidYmd, kstDayRange } from "../src/lib/history/buckets";

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? "";
}

function parseYmd(raw: string | null, argName: string, fallback: string): string {
  if (raw === null) return fallback;
  if (!isValidYmd(raw)) throw new Error(`${argName} 은 YYYY-MM-DD 여야 합니다 (got: "${raw}")`);
  return raw;
}

function parsePositiveInt(raw: string | null, argName: string): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${argName} 은 1 이상의 정수여야 합니다 (got: "${raw}")`);
  return n;
}

async function main() {
  const from = parseYmd(parseArg("--from"), "--from", "2020-01-01");
  const to = parseYmd(parseArg("--to"), "--to", todayKSTString());
  if (from > to) throw new Error(`--from (${from}) 이 --to (${to}) 보다 늦습니다`);
  const limit = parsePositiveInt(parseArg("--limit"), "--limit");
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");

  console.log(`[backfill:hrr] ${from} ~ ${to}${limit ? ` · limit ${limit}` : ""}${force ? " · force" : ""}${dryRun ? " · dry-run" : ""}`);
  const started = Date.now();
  const result = await fillRecoveryColumns({
    from: kstDayRange(from).start,
    to: kstDayRange(to).end,
    force,
    dryRun,
    limit,
    log: (line) => console.log(line),
  });
  console.log(
    `[backfill:hrr] 완료 (${((Date.now() - started) / 1000).toFixed(1)}s) — 대상 ${result.candidates} · 갱신 ${result.updated} · 레코드 없음 ${result.missing} · 결측 ${result.skipped}${dryRun ? " (dry-run: 저장 안 함)" : ""}`,
  );
  if (!dryRun && result.updated > 0) console.log("[backfill:hrr] 웹 캐시는 별 프로세스 — `pm2 restart` 또는 10분 뒤 반영");
}

main()
  .catch((err) => {
    console.error("[backfill:hrr] 실패:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
