/**
 * #278: 이미 저장된 Activity 의 rawData 로부터 러닝 다이나믹스 필드를 재파싱.
 *
 * 실행: npx tsx scripts/backfill-running-dynamics.ts [--limit N] [--dry-run]
 *
 * 배경: 이전 fetcher 가 존재하지 않는 `summaryDTO.*` 경로에서 값을 찾아 전 활동이 null 로
 * 저장됨. rawData 는 이미 저장되어 있으므로 재파싱만으로 복구 가능 (Garmin API 재호출 X).
 *
 * 옵션:
 *  --limit N   상한 (positive integer). 미지정 시 전량.
 *  --dry-run   대상만 출력.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { parseRunningDynamics } from "../src/lib/garmin/parse-running-dynamics";

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
  const dryRun = hasFlag("--dry-run");

  const rows = await prisma.activity.findMany({
    where: {
      // 대상 조건:
      //  1) 필드 중 하나라도 null (아예 파싱 안 된 활동)
      //  2) trainingEffect null (기존 backfill-m2-fields 는 이 필드 안 채움)
      //  3) avgStrideLength > 10 — meters 라면 절대 나올 수 없는 값. cm 로 잘못 저장된 legacy
      //     rows (기존 backfill-m2-fields 는 ÷100 없이 저장) 를 잡아내는 신호.
      // rawData 자체가 없는 아주 오래된 record 는 parseRunningDynamics 가 empty 반환 → 스킵.
      OR: [
        { avgCadence: null },
        { avgStrideLength: null },
        { avgVerticalOscillation: null },
        { avgGroundContactTime: null },
        { aerobicTE: null },
        { anaerobicTE: null },
        { trainingEffect: null },
        { avgStrideLength: { gt: 10 } },
      ],
    },
    orderBy: { startTime: "desc" },
    select: {
      id: true,
      name: true,
      startTime: true,
      activityType: true,
      rawData: true,
    },
    ...(limit !== undefined ? { take: limit } : {}),
  });

  console.log(
    `backfill-running-dynamics: 대상 ${rows.length} 건${limit !== undefined ? ` (limit ${limit})` : ""}${dryRun ? " [dry-run]" : ""}`,
  );

  if (dryRun) {
    for (const r of rows.slice(0, 10)) {
      const d = parseRunningDynamics(r.rawData);
      console.log(
        `  · ${r.startTime.toISOString()} ${r.activityType} "${r.name}" — ` +
          `cadence=${d.avgCadence ?? "-"} aerobicTE=${d.aerobicTE ?? "-"} anaerobicTE=${d.anaerobicTE ?? "-"}`,
      );
    }
    if (rows.length > 10) console.log(`  ... 외 ${rows.length - 10} 건`);
    return;
  }

  let updated = 0;
  let empty = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = parseRunningDynamics(r.rawData);
    const hasAny =
      d.avgCadence !== null ||
      d.avgStrideLength !== null ||
      d.avgVerticalOscillation !== null ||
      d.avgGroundContactTime !== null ||
      d.aerobicTE !== null ||
      d.anaerobicTE !== null;
    if (!hasAny) {
      empty++;
      continue;
    }
    await prisma.activity.update({
      where: { id: r.id },
      data: {
        avgCadence: d.avgCadence,
        avgStrideLength: d.avgStrideLength,
        avgVerticalOscillation: d.avgVerticalOscillation,
        avgGroundContactTime: d.avgGroundContactTime,
        aerobicTE: d.aerobicTE,
        anaerobicTE: d.anaerobicTE,
        trainingEffect: d.trainingEffect,
      },
    });
    updated++;
    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(`  진행 ${i + 1}/${rows.length} — 갱신 ${updated}, 값없음 ${empty}`);
    }
  }

  console.log(`완료: 갱신 ${updated}, rawData 에 값 없음 ${empty}`);
}

main()
  .catch((err) => {
    console.error("backfill 실패:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
