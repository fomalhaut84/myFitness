/**
 * #364 회귀 검증 — MCP 응답의 날짜 라벨이 KST 기준인지.
 *
 * 배경: get_weight_loss_status 의 dailyBalances[].date 가 `toISOString().slice(0,10)` 이었다.
 * DailySummary.date 는 KST 자정의 UTC instant (KST 09-03 → 2026-09-02T15:00:00Z) 라
 * UTC 절단이 라벨을 하루 앞으로 밀었고, ymdKST 를 쓰는 macroSummary 와 어긋나
 * AI 가 "어제 식단 데이터 없음" 으로 오보했다 (2026-09-04 모닝 리포트).
 *
 * 프로젝트에 테스트 프레임워크가 없어 workflow.md 8-5 에 따라 스크립트로 대체.
 * DB 불필요 — 순수 함수만 검증.
 *
 * 실행: npx tsx scripts/test-mcp-date-labels.ts
 */

import { ymdKST } from "../src/lib/garmin/utils";

/** 수정 전 구현. 이 스크립트에서만 재현용으로 유지 — 실코드에는 없어야 한다. */
function legacyUtcLabel(d: Date): string {
  return d.toISOString().slice(0, 10);
}

let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

interface Case {
  desc: string;
  instant: string;
  expectedKST: string;
  /** 구 구현이 실제로 밀렸던 값. null 이면 구 구현도 우연히 일치 (밀림 없음). */
  legacyWas: string | null;
}

const CASES: Case[] = [
  {
    desc: "DailySummary.date — KST 09-03 자정 instant",
    instant: "2026-09-02T15:00:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: "2026-09-02",
  },
  {
    desc: "DailySummary.date — KST 09-04 자정 instant (오늘 행)",
    instant: "2026-09-03T15:00:00.000Z",
    expectedKST: "2026-09-04",
    legacyWas: "2026-09-03",
  },
  {
    desc: "Activity.startTime — KST 09-03 07:00 아침 러닝",
    instant: "2026-09-02T22:00:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: "2026-09-02",
  },
  {
    desc: "Activity.startTime — KST 09-03 08:59 (밀림 경계 직전)",
    instant: "2026-09-02T23:59:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: "2026-09-02",
  },
  {
    desc: "Activity.startTime — KST 09-03 09:00 (경계, 여기부터 UTC 도 일치)",
    instant: "2026-09-03T00:00:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: null,
  },
  {
    desc: "Activity.startTime — KST 09-03 23:59 (하루 끝)",
    instant: "2026-09-03T14:59:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: null,
  },
  {
    desc: "월 경계 — KST 09-01 자정 instant",
    instant: "2026-08-31T15:00:00.000Z",
    expectedKST: "2026-09-01",
    legacyWas: "2026-08-31",
  },
  {
    desc: "연 경계 — KST 2027-01-01 자정 instant",
    instant: "2026-12-31T15:00:00.000Z",
    expectedKST: "2027-01-01",
    legacyWas: "2026-12-31",
  },
];

function main(): void {
  console.log("\n#364 — MCP 날짜 라벨 KST 정합\n");

  for (const c of CASES) {
    const d = new Date(c.instant);
    check(`${c.desc} → ${c.expectedKST}`, ymdKST(d) === c.expectedKST);
  }

  console.log("\n구 구현(UTC 절단)이 실제로 밀렸음을 확인 — 회귀 시 즉시 드러나도록\n");

  for (const c of CASES) {
    const d = new Date(c.instant);
    if (c.legacyWas === null) {
      check(
        `${c.desc} — 구 구현도 일치 (밀림 없는 구간)`,
        legacyUtcLabel(d) === c.expectedKST,
      );
    } else {
      check(
        `${c.desc} — 구 구현은 ${c.legacyWas} 로 밀렸음`,
        legacyUtcLabel(d) === c.legacyWas && c.legacyWas !== c.expectedKST,
      );
    }
  }

  console.log("\n서버 TZ 무관성 — ymdKST 는 Intl 기반이라 process.env.TZ 에 영향받지 않아야 함\n");

  const probe = new Date("2026-09-02T15:00:00.000Z");
  const originalTZ = process.env.TZ;
  const observed: string[] = [];
  for (const tz of ["UTC", "America/New_York", "Asia/Seoul", "Pacific/Kiritimati"]) {
    process.env.TZ = tz;
    observed.push(ymdKST(probe));
  }
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;

  check(
    `4개 TZ 에서 모두 2026-09-03 (관측: ${[...new Set(observed)].join(", ")})`,
    observed.every((v) => v === "2026-09-03"),
  );

  if (failed > 0) {
    console.error(`\n❌ ${failed}건 실패`);
    process.exit(1);
  }
  console.log("\n✅ 전체 통과");
  process.exit(0);
}

main();
