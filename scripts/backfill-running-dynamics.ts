/**
 * #278: 이미 저장된 Activity 의 rawData 로부터 러닝 다이나믹스 필드를 재파싱.
 *
 * 실행:
 *   npx tsx scripts/backfill-running-dynamics.ts [--limit N] [--after <ISO>] [--dry-run]
 *
 * 배경: 이전 fetcher 가 존재하지 않는 `summaryDTO.*` 경로에서 값을 찾아 전 활동이 null 로
 * 저장됨. rawData 는 이미 저장되어 있으므로 재파싱만으로 복구 가능 (Garmin API 재호출 X).
 *
 * 옵션:
 *  --limit N     상한 (positive integer). 미지정 시 전량.
 *  --after ISO   startTime 이 이 값보다 큰 row 만 대상 (stable cursor). 매 실행 마지막에 출력되는
 *                "next --after=..." 값을 다음 실행에 전달하면 mutating query 에서도 안전하게
 *                진행 가능. Codex P2 (#278): `skip N` offset 은 성공한 row 가 결과셋에서 빠지면
 *                실제 처리 대상이 밀려나 unprocessed row 를 건너뛰는 문제.
 *  --dry-run     대상만 출력.
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

function parseIsoDate(raw: string | null, argName: string): Date | undefined {
  if (raw === null) return undefined;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) {
    throw new Error(`${argName} 은 유효한 ISO 8601 시각이어야 합니다 (got: "${raw}")`);
  }
  return d;
}

async function main() {
  const limit = parsePositiveInt(parseArg("--limit"), "--limit");
  const after = parseIsoDate(parseArg("--after"), "--after");
  const dryRun = hasFlag("--dry-run");

  const rows = await prisma.activity.findMany({
    where: {
      // 대상 조건:
      //  1) 필드 중 하나라도 null (아예 파싱 안 된 활동)
      //  2) trainingEffect null (기존 backfill-m2-fields 는 이 필드 안 채움)
      //  3) avgStrideLength > 10 — meters 라면 절대 나올 수 없는 값. cm 로 잘못 저장된 legacy
      //     rows (기존 backfill-m2-fields 는 ÷100 없이 저장) 를 잡아내는 신호.
      // rawData 자체가 없는 아주 오래된 record 는 parseRunningDynamics 가 empty 반환 → 스킵.
      AND: [
        {
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
        // Codex P2 stable cursor: --after 로 startTime 하한 부여. 이전 배치의
        // 마지막 startTime 을 그대로 넘기면 다음 배치는 그 이후 row 만 처리.
        ...(after ? [{ startTime: { gt: after } }] : []),
      ],
    },
    // asc 로 오래된 활동부터. --limit 사용 시 cursor 로 진행 (--after).
    orderBy: { startTime: "asc" },
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
    `backfill-running-dynamics: 대상 ${rows.length} 건${after ? ` (after ${after.toISOString()})` : ""}${limit !== undefined ? ` (limit ${limit})` : ""}${dryRun ? " [dry-run]" : ""}`,
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
  if (rows.length > 0 && limit !== undefined && rows.length === limit) {
    // 배치가 상한에 도달 — 다음 배치를 위한 stable cursor 안내.
    const last = rows[rows.length - 1].startTime.toISOString();
    console.log(`다음 배치: --after ${last} --limit ${limit}`);
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
