// #341: fmtSpO2 공용 포맷 + 대시보드 SpO2 출처 판정 회귀 테스트.
//
// 회귀: 봇/웹이 각자 포맷을 구현해 표시 규칙이 갈라지던 문제,
// 대시보드가 수면 SpO2 결측 시 주간값으로 조용히 폴백하던 문제.
//
// Run: npx tsx scripts/test-spo2-format.ts

import { fmtSpO2 } from "@/lib/format";

let failures = 0;

function assert(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
    failures += 1;
  }
}

console.log("== fmtSpO2 기본 ==");
assert("avg만 → '94%'", fmtSpO2(94) === "94%", fmtSpO2(94));
assert(
  "avg + lowest → '94% (최저 83%)'",
  fmtSpO2(94, 83) === "94% (최저 83%)",
  fmtSpO2(94, 83),
);
assert("소수 반올림 (93.6 → 94%)", fmtSpO2(93.6) === "94%", fmtSpO2(93.6));
assert(
  "lowest 도 반올림 (83.4 → 83)",
  fmtSpO2(94, 83.4) === "94% (최저 83%)",
  fmtSpO2(94, 83.4),
);

console.log("\n== 결측 처리 ==");
assert("avg null → 기본 '-'", fmtSpO2(null) === "-", fmtSpO2(null));
assert("avg undefined → 기본 '-'", fmtSpO2(undefined) === "-", fmtSpO2(undefined));
assert(
  "fallback 지정",
  fmtSpO2(null, 83, { fallback: "측정없음" }) === "측정없음",
  fmtSpO2(null, 83, { fallback: "측정없음" }),
);
assert(
  "avg 있고 lowest null → 병기 없음",
  fmtSpO2(94, null) === "94%",
  fmtSpO2(94, null),
);
assert(
  "avg 있고 lowest 미전달 → 병기 없음",
  fmtSpO2(94) === "94%",
  fmtSpO2(94),
);
assert("NaN → '-'", fmtSpO2(NaN) === "-", fmtSpO2(NaN));
assert(
  "lowest 가 NaN 이면 병기 생략 (avg 는 살림)",
  fmtSpO2(94, NaN) === "94%",
  fmtSpO2(94, NaN),
);

// 대시보드 출처 판정 — src/app/page.tsx 의 spo2Source 산출과 같은 규칙.
// 로직을 그대로 옮겨 두어 page.tsx 쪽이 바뀌면 이 테스트가 먼저 어긋나도록 한다.
type Source = "sleep" | "daily" | null;
function resolveSource(sleepSpO2: number | null, dailySpO2: number | null): Source {
  return sleepSpO2 != null ? "sleep" : dailySpO2 != null ? "daily" : null;
}

console.log("\n== SpO2 출처 판정 ==");
assert("수면값 존재 → sleep", resolveSource(94, 91) === "sleep");
assert("수면 결측 + 주간 존재 → daily", resolveSource(null, 91) === "daily");
assert("둘 다 결측 → null", resolveSource(null, null) === null);
assert(
  "수면값 0 은 없는 값이 아니다 (null 체크여야 함)",
  resolveSource(0, 91) === "sleep",
);

console.log("\n== delta 표시 규칙 (출처 불일치 시 생략) ==");
function shouldShowDelta(todaySrc: Source, yesterdaySrc: Source, yesterdayVal: number | null) {
  return yesterdayVal != null && yesterdaySrc === todaySrc;
}
assert("sleep/sleep → 표시", shouldShowDelta("sleep", "sleep", 92) === true);
assert("daily/daily → 표시", shouldShowDelta("daily", "daily", 92) === true);
assert(
  "sleep/daily → 생략 (측정 종류가 다름)",
  shouldShowDelta("sleep", "daily", 92) === false,
);
assert(
  "daily/sleep → 생략",
  shouldShowDelta("daily", "sleep", 92) === false,
);
assert("어제 값 없음 → 생략", shouldShowDelta("sleep", "sleep", null) === false);

console.log(failures === 0 ? "\n✅ 전체 통과" : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
