/**
 * #364 회귀 검증 — MCP 응답의 날짜 라벨이 KST 기준인지.
 *
 * 배경: get_weight_loss_status 의 dailyBalances[].date 가 `toISOString().slice(0,10)` 이었다.
 * DailySummary.date 는 KST 자정의 UTC instant (KST 09-03 → 2026-09-02T15:00:00Z) 라
 * UTC 절단이 라벨을 하루 앞으로 밀었고, ymdKST 를 쓰는 macroSummary 와 어긋나
 * AI 가 "어제 식단 데이터 없음" 으로 오보했다 (2026-09-04 모닝 리포트).
 *
 * 프로젝트에 테스트 프레임워크가 없어 workflow.md 8-5 에 따라 스크립트로 대체.
 *
 * **두 겹으로 막는다** (사전 리뷰 P1 — 초판은 ymdKST 헬퍼만 검증해서 호출부를 되돌려도
 * 통과했다):
 *   1. 프로덕션 mapper (toBalanceRow / toActivityRow) 를 직접 호출 → 헬퍼 회귀를 잡는다
 *   2. src/mcp/** 소스 스캔 → mapper 를 우회해 호출부에 UTC 절단을 인라인하는 것을 잡는다
 *
 * 실행: npm run verify:mcp-date-labels
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ymdKST } from "../src/lib/garmin/utils";
import { toActivityRow, toBalanceRow } from "../src/mcp/tools/weight-loss";

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
  /** 구 구현이 실제로 밀렸던 값. null 이면 구 구현도 우연히 일치 (밀림 없는 구간). */
  legacyWas: string | null;
}

const CASES: Case[] = [
  {
    desc: "KST 09-03 자정 instant (DailySummary.date)",
    instant: "2026-09-02T15:00:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: "2026-09-02",
  },
  {
    desc: "KST 09-04 자정 instant (오늘 행)",
    instant: "2026-09-03T15:00:00.000Z",
    expectedKST: "2026-09-04",
    legacyWas: "2026-09-03",
  },
  {
    desc: "KST 09-03 07:00 아침 러닝",
    instant: "2026-09-02T22:00:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: "2026-09-02",
  },
  {
    desc: "KST 09-03 08:59 (밀림 경계 직전)",
    instant: "2026-09-02T23:59:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: "2026-09-02",
  },
  {
    desc: "KST 09-03 09:00 (경계, 여기부터 UTC 도 일치)",
    instant: "2026-09-03T00:00:00.000Z",
    expectedKST: "2026-09-03",
    legacyWas: null,
  },
  {
    desc: "KST 09-03 23:59 (하루 끝)",
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

/**
 * src/mcp/** 에서 UTC 절단이 허용되는 지점. 근거를 함께 남긴다.
 *
 * **최소로 유지할 것.** 실제로 걸리지 않는 파일을 넣어두면 그 파일에 나중에 들어오는
 * 절단을 조용히 통과시킨다 (초판에 splits/fitness/user-profile 를 넣었다가 제거 — 셋 다
 * 전체 ISO 만 쓰므로 애초에 정규식에 걸리지 않는다).
 */
const SCAN_ALLOWLIST: Record<string, string> = {
  "src/mcp/logger.ts":
    "Date.now()+9h 를 선반영한 뒤 UTC 로 읽으므로 결과가 KST 벽시계 날짜 (주석에 근거 명시)",
  // #365: 스캔 범위를 src/app · src/bot · src/components · src/lib 로 확장하면서 걸리는 의도된 UTC 절단
  "src/lib/weather/open-meteo.ts":
    "외부 API (Open-Meteo archive) 의 날짜 파라미터 — 기상 보강의 날짜 경계는 별도 판단 (365 스펙 §7)",
  "src/app/api/training-plan/[planId]/workouts/[date]/route.ts":
    "UTC 자정으로 파싱한 값을 같은 UTC 로 되읽는 왕복 검증 — KST 변환이 목적이 아니다",
};

/** #365: 절단 · 로컬 라벨 스캔 대상 (테스트 제외). "use client" 파일은 브라우저 TZ 라 로컬 라벨 스캔에서 뺀다 */
const SCAN_DIRS = ["src/mcp", "src/app", "src/bot", "src/components", "src/lib"];
// 숫자의 `toLocaleString("ko-KR")` (천 단위 구분) 은 TZ 와 무관 — 날짜 · 시각 호출만 본다
const LOCALE_CALL_RE = /\.toLocale(Date|Time)String\(/;
const LOOKAHEAD_LINES = 4;

function isClientFile(src: string): boolean {
  return /^\s*["']use client["']/m.test(src.split("\n").slice(0, 5).join("\n"));
}

const TRUNCATION_RE = /toISOString\(\)\s*\.\s*(slice|split|substring)\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      walk(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function scanForTruncation(): void {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const rel = file.replace(/\\/g, "/");
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (!TRUNCATION_RE.test(line)) return;
        if (SCAN_ALLOWLIST[rel]) return;
        offenders.push(`${rel}:${i + 1} → ${line.trim()}`);
      });
    }
  }
  check(
    offenders.length === 0
      ? `${SCAN_DIRS.join(" · ")} 에 허용되지 않은 toISOString() 절단 없음`
      : `UTC 절단 발견:\n      ${offenders.join("\n      ")}`,
    offenders.length === 0,
  );
}

/**
 * #365: 서버에서 실행되는 파일의 `toLocaleDateString()` · `toLocaleTimeString()` 에 `timeZone` 이 없으면
 * 호스트 TZ 를 따른다 (봇 /sleep · /weight · /run 이 그랬다). 호출 줄과 그 아래 4줄 안에 `timeZone` 이 있어야 통과.
 * "use client" 파일은 브라우저 TZ (= 사용자) 라 제외. 서버 라벨은 `formatDateKST` (src/lib/format.ts) 로.
 */
function scanForLocalLabels(): void {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const rel = file.replace(/\\/g, "/");
      const src = readFileSync(file, "utf-8");
      if (isClientFile(src)) continue;
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!LOCALE_CALL_RE.test(line)) return;
        const window = lines.slice(i, i + 1 + LOOKAHEAD_LINES).join("\n");
        if (/timeZone/.test(window)) return;
        offenders.push(`${rel}:${i + 1} → ${line.trim()}`);
      });
    }
  }
  check(
    offenders.length === 0
      ? "서버 파일의 toLocaleDateString/TimeString() 에 timeZone 누락 없음 (#365)"
      : `timeZone 없는 toLocaleDateString/TimeString() 발견 (#365):\n      ${offenders.join("\n      ")}`,
    offenders.length === 0,
  );
}

function main(): void {
  console.log("\n#364 — MCP 날짜 라벨 KST 정합\n");

  console.log("[1] 프로덕션 mapper 직접 검증 (toBalanceRow / toActivityRow)\n");
  for (const c of CASES) {
    const d = new Date(c.instant);
    const balance = toBalanceRow({
      date: d,
      estimatedIntakeCalories: 2151,
      availableCalories: 2663,
      activeCalories: 773,
      calorieBalance: -512,
    });
    check(`toBalanceRow — ${c.desc} → ${c.expectedKST}`, balance.date === c.expectedKST);

    const activity = toActivityRow({
      name: "아침 러닝",
      activityType: "running",
      startTime: d,
      intensityLabel: "easy",
      estimatedZone: 2,
      routeTag: null,
    });
    check(`toActivityRow — ${c.desc} → ${c.expectedKST}`, activity.date === c.expectedKST);
  }

  console.log("\n[2] 구 구현(UTC 절단)이 실제로 밀렸음 — 회귀 시 즉시 드러나도록\n");
  for (const c of CASES) {
    const d = new Date(c.instant);
    if (c.legacyWas === null) {
      check(`${c.desc} — 구 구현도 일치 (밀림 없는 구간)`, legacyUtcLabel(d) === c.expectedKST);
    } else {
      check(
        `${c.desc} — 구 구현은 ${c.legacyWas} 로 밀렸음`,
        legacyUtcLabel(d) === c.legacyWas && c.legacyWas !== c.expectedKST,
      );
    }
  }

  console.log("\n[3] 소스 스캔 — mapper 우회로 UTC 절단이 인라인되는 것 차단\n");
  scanForTruncation();
  scanForLocalLabels();

  console.log("\n[4] 서버 TZ 무관성\n");
  // 사전 리뷰 P0: TZ 전환이 실제로 먹었는지 먼저 단언하지 않으면 이 블록은 공허하다
  // (ymdKST 는 자기 timeZone 을 고정하므로 TZ 가 inert 여도 통과한다).
  const probe = "2026-09-02T15:00:00.000Z";
  const TZS = ["UTC", "Pacific/Kiritimati", "Asia/Seoul", "Etc/GMT+12"];
  const originalTZ = process.env.TZ;
  const localDays = new Set<number>();
  const kstLabels = new Set<string>();
  for (const tz of TZS) {
    process.env.TZ = tz;
    localDays.add(new Date(probe).getDate()); // 서버 로컬 해석 — TZ 반영 여부 확인용
    kstLabels.add(ymdKST(new Date(probe)));
  }
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;

  check(
    `TZ 전환이 실제로 반영됨 (로컬 날짜 관측: ${[...localDays].sort().join(", ")} — 2종 이상이어야 유효)`,
    localDays.size > 1,
  );
  check(
    `그럼에도 ymdKST 는 전 TZ 에서 2026-09-03 (관측: ${[...kstLabels].join(", ")})`,
    kstLabels.size === 1 && kstLabels.has("2026-09-03"),
  );

  if (failed > 0) {
    console.error(`\n❌ ${failed}건 실패`);
    process.exit(1);
  }
  console.log("\n✅ 전체 통과");
  process.exit(0);
}

main();
