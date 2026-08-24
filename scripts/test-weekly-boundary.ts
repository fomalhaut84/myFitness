// #321: Unit tests for KST week boundary helpers + personal-goals shape.
// Run: npx tsx scripts/test-weekly-boundary.ts
//
// DB 없이 동작 — startOfWeekKST 는 순수 함수. computePersonalGoals 는 prisma stub 로 검증.

import { startOfWeekKST, endOfWeekKST, weekStartKST } from "@/lib/date";
import { ymdKST } from "@/lib/garmin/utils";

let failures = 0;

function assert(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
    failures += 1;
  }
}

function fmtKst(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).format(d);
}

console.log("== startOfWeekKST — 요일별 경계 ==");
{
  // 2025-01-06 (Mon) → 자기 자신
  const mon = new Date("2025-01-06T05:00:00+09:00");
  const s = startOfWeekKST(mon);
  assert(
    "월요일 오전 → 같은 날 00:00 KST",
    s.toISOString() === "2025-01-05T15:00:00.000Z",
    `got ${s.toISOString()} (${fmtKst(s)})`,
  );
}
{
  // 2025-01-12 (Sun) → 6일 전 월요일 (2025-01-06)
  const sun = new Date("2025-01-12T22:00:00+09:00");
  const s = startOfWeekKST(sun);
  assert(
    "일요일 밤 → 6일 전 월요일 00:00 KST",
    s.toISOString() === "2025-01-05T15:00:00.000Z",
    `got ${s.toISOString()} (${fmtKst(s)})`,
  );
}
{
  // 2025-01-08 (Wed) → 2일 전 월요일 (2025-01-06)
  const wed = new Date("2025-01-08T12:00:00+09:00");
  const s = startOfWeekKST(wed);
  assert(
    "수요일 정오 → 이틀 전 월요일 00:00 KST",
    s.toISOString() === "2025-01-05T15:00:00.000Z",
    `got ${s.toISOString()} (${fmtKst(s)})`,
  );
}
{
  // 서버가 UTC 라 KST 자정 근처 boundary
  // KST 2025-01-06 Mon 00:30 = UTC 2025-01-05 Sun 15:30
  const nearMidnight = new Date("2025-01-05T15:30:00Z");
  const s = startOfWeekKST(nearMidnight);
  assert(
    "KST 월요일 00:30 (UTC 일요일 15:30) → KST 월요일 00:00",
    s.toISOString() === "2025-01-05T15:00:00.000Z",
    `got ${s.toISOString()}`,
  );
}
{
  // KST 2025-01-06 Mon 00:00 = UTC 2025-01-05 Sun 15:00 exactly
  const exact = new Date("2025-01-05T15:00:00Z");
  const s = startOfWeekKST(exact);
  assert(
    "정확히 KST 월요일 00:00 → 자기 자신",
    s.toISOString() === "2025-01-05T15:00:00.000Z",
    `got ${s.toISOString()}`,
  );
}
{
  // KST 2025-01-05 Sun 23:59 = UTC 2025-01-05 Sun 14:59 → 지난 월요일 (2024-12-30)
  const almost = new Date("2025-01-05T14:59:00Z");
  const s = startOfWeekKST(almost);
  assert(
    "KST 일요일 23:59 → 지난 월요일 (2024-12-30) 00:00",
    s.toISOString() === "2024-12-29T15:00:00.000Z",
    `got ${s.toISOString()} (${fmtKst(s)})`,
  );
}

console.log("\n== endOfWeekKST — 다음 주 월요일 00:00 KST ==");
{
  const wed = new Date("2025-01-08T12:00:00+09:00");
  const e = endOfWeekKST(wed);
  assert(
    "수요일 → 다음 주 월요일 (2025-01-13) 00:00",
    e.toISOString() === "2025-01-12T15:00:00.000Z",
    `got ${e.toISOString()} (${fmtKst(e)})`,
  );
}

console.log("\n== weekStartKST(offset) — 지난 N주 월요일 ==");
{
  const wed = new Date("2025-01-08T12:00:00+09:00");
  const zero = weekStartKST(0, wed);
  const one = weekStartKST(1, wed);
  const four = weekStartKST(4, wed);
  assert(
    "offset=0 = 이번 주 월요일 (2025-01-06)",
    zero.toISOString() === "2025-01-05T15:00:00.000Z",
    `got ${zero.toISOString()}`,
  );
  assert(
    "offset=1 = 지난 주 월요일 (2024-12-30)",
    one.toISOString() === "2024-12-29T15:00:00.000Z",
    `got ${one.toISOString()}`,
  );
  assert(
    "offset=4 = 4주 전 월요일 (2024-12-09)",
    four.toISOString() === "2024-12-08T15:00:00.000Z",
    `got ${four.toISOString()}`,
  );
}

console.log("\n== DST 없는 KST — 년 경계 ==");
{
  // 2026-01-01 (Thu) → 이번 주 시작 = 2025-12-29 (Mon)
  const nyd = new Date("2026-01-01T09:00:00+09:00");
  const s = startOfWeekKST(nyd);
  assert(
    "2026-01-01 (목) → 이번 주 월요일 = 2025-12-29",
    s.toISOString() === "2025-12-28T15:00:00.000Z",
    `got ${s.toISOString()} (${fmtKst(s)})`,
  );
}

console.log("\n== activities/page weekLabel — UTC 서버라도 KST wall-clock 유지 ==");
{
  // #321 리뷰 P1 회귀: weekStartKST(i, now) 로 얻은 Date 는 KST Mon 00:00 인스턴트라
  // UTC 로 보면 전날 15:00. label 을 `${d.getMonth()+1}/${d.getDate()}` 로 만들면
  // UTC 서버에서 하루 밀림. ymdKST() 로 파싱해야 KST 날짜 유지.
  const now = new Date("2025-01-08T12:00:00+09:00"); // 수요일
  const wStart = weekStartKST(0, now); // 이번 주 월요일 = 2025-01-06 KST
  const [, mm, dd] = ymdKST(wStart).split("-");
  const label = `${Number(mm)}/${Number(dd)}`;
  assert(
    "UTC 서버라도 이번 주 월요일 label = '1/6' (하루 밀리지 않음)",
    label === "1/6",
    `got '${label}' (wStart UTC=${wStart.toISOString()}, getDate=${wStart.getUTCDate()})`,
  );

  const past = weekStartKST(4, now); // 4주 전 월요일 = 2024-12-09 KST
  const [, pmm, pdd] = ymdKST(past).split("-");
  const pastLabel = `${Number(pmm)}/${Number(pdd)}`;
  assert(
    "4주 전 월요일 label = '12/9' (년 경계 넘어도 KST 유지)",
    pastLabel === "12/9",
    `got '${pastLabel}' (past UTC=${past.toISOString()})`,
  );
}

console.log("\n== 요약 ==");
if (failures === 0) {
  console.log("✅ 모든 assertion 통과");
  process.exit(0);
} else {
  console.log(`❌ ${failures} assertion 실패`);
  process.exit(1);
}
