/**
 * #396: 이미 저장된 Activity 의 rawData 에서 `eventType.typeKey` 를 컬럼으로 승격.
 *
 * 실행:
 *   npm run backfill:event-type -- [--limit N] [--after-id <cuid>] [--dry-run] [--force]
 *
 * 배경: `Activity.eventType` 컬럼은 #396 에서 추가됐다. Garmin 이 활동마다 내려주는 `eventType.typeKey`
 * ("race" · "training" · "uncategorized" …) 는 rawData 에 이미 있으므로 재파싱만으로 채운다 (Garmin API 재호출 X).
 *
 * 옵션:
 *  --limit N            상한 (positive integer). 미지정 시 전량.
 *  --after-id <cuid>    이 id 를 기준으로 (startTime, id) composite cursor. startTime 은 unique 아님
 *                       (동일 시각 여러 활동 가능) — id 로 lookup 해 composite 조건 적용 (#278 선례).
 *  --dry-run            대상과 파싱 결과 분포만 출력.
 *  --force              eventType 이 이미 있는 행도 대상에 넣어 rawData 값으로 덮어쓴다.
 *
 * 배치 진행: `--limit` 으로 끊었으면 종료 시 다음 커서용 `--after-id <cuid>` 를 출력.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { parseEventType } from "../src/lib/garmin/parse-event-type";

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

function tally(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
}

async function main() {
  const limit = parsePositiveInt(parseArg("--limit"), "--limit");
  const afterId = parseArg("--after-id") || undefined;
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");

  let cursor: { startTime: Date; id: string } | undefined;
  if (afterId) {
    const anchor = await prisma.activity.findUnique({
      where: { id: afterId },
      select: { id: true, startTime: true },
    });
    if (!anchor) throw new Error(`--after-id "${afterId}" 로 활동을 찾을 수 없습니다`);
    cursor = { startTime: anchor.startTime, id: anchor.id };
  }

  const rows = await prisma.activity.findMany({
    where: {
      AND: [
        ...(force ? [] : [{ eventType: null }]),
        // composite cursor: (startTime > c.startTime) OR (startTime == c.startTime AND id > c.id)
        ...(cursor
          ? [
              {
                OR: [
                  { startTime: { gt: cursor.startTime } },
                  { AND: [{ startTime: cursor.startTime }, { id: { gt: cursor.id } }] },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    select: { id: true, name: true, startTime: true, eventType: true, rawData: true },
    ...(limit !== undefined ? { take: limit } : {}),
  });

  console.log(
    `backfill-event-type: 대상 ${rows.length} 건${cursor ? ` (after-id ${cursor.id} @ ${cursor.startTime.toISOString()})` : ""}${limit !== undefined ? ` (limit ${limit})` : ""}${force ? " [force]" : ""}${dryRun ? " [dry-run]" : ""}`,
  );

  const parsed = new Map<string, number>();
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const value = parseEventType(r.rawData);
    tally(parsed, value ?? "(없음)");
    if (dryRun) {
      if (i < 10) console.log(`  · ${r.startTime.toISOString()} "${r.name}" → ${value ?? "-"}`);
      continue;
    }
    if (value === null || value === r.eventType) {
      skipped++;
    } else {
      await prisma.activity.update({ where: { id: r.id }, data: { eventType: value } });
      updated++;
    }
    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(`  진행 ${i + 1}/${rows.length} — 갱신 ${updated} · 스킵 ${skipped}`);
    }
  }

  if (dryRun && rows.length > 10) console.log(`  ... 외 ${rows.length - 10} 건`);
  console.log(`파싱 분포: ${formatCounts(parsed) || "(대상 없음)"}`);
  if (!dryRun) console.log(`완료: 갱신 ${updated} · 스킵 ${skipped} (rawData 에 eventType 없음 또는 동일 값)`);

  if (limit !== undefined && rows.length === limit) {
    const last = rows[rows.length - 1];
    console.log(`다음 배치: npm run backfill:event-type -- --after-id ${last.id} --limit ${limit}${force ? " --force" : ""}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
