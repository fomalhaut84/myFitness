/**
 * #283 (M14 Phase 1) — Codex P1: transient AI 실패로 kcal null 남은 FoodLog 재추정.
 *
 * 실행: npx tsx scripts/backfill-food-kcal.ts [--limit N] [--older-than <sec>] [--dry-run]
 *
 * 조건:
 *  - estimatedKcal IS NULL
 *  - createdAt < NOW() - olderThanSec (기본 60s — 봇의 첫 AI 호출과 race 회피)
 *
 * 정책:
 *  - AI 실패 → 계속 null → 다음 실행에서 재시도
 *  - AI 성공 → estimatedKcal 갱신 + 해당 날짜 recalculateCalorieBalance
 *  - 사용자가 웹 PATCH 로 명시적 null 설정한 경우도 재추정 대상 (Phase 1 은 sentinel 안 씀)
 *
 * 옵션:
 *  --limit N          1회 실행 최대 처리 건수. 미지정 시 전량.
 *  --older-than SEC   생성 후 이 시간 지난 로그만 (기본 60).
 *  --dry-run          대상만 출력, update 안 함.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { runFoodKcalBackfill } from "../src/lib/nutrition/backfill";

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? "";
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parsePositiveInt(raw: string | null, argName: string): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`${argName} 은 1 이상의 정수여야 합니다 (got: "${raw}")`);
  }
  return n;
}

async function main() {
  const limit = parsePositiveInt(parseArg("--limit"), "--limit");
  const olderThanSec = parsePositiveInt(parseArg("--older-than"), "--older-than") ?? 60;
  const dryRun = hasFlag("--dry-run");

  const result = await runFoodKcalBackfill({
    limit,
    olderThanSec,
    dryRun,
    verbose: true,
  });
  console.log(
    `backfill-food-kcal: 대상 ${result.candidates} 건${limit !== undefined ? ` (limit ${limit})` : ""}${dryRun ? " [dry-run]" : ""}`,
  );
  if (!dryRun) {
    console.log(`완료: 성공 ${result.ok}, 실패 ${result.failed}`);
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
