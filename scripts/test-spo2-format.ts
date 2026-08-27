// #341: fmtSpO2 공용 포맷 + 대시보드 SpO2 출처 판정 회귀 테스트.
//
// 회귀: 봇/웹이 각자 포맷을 구현해 표시 규칙이 갈라지던 문제,
// 대시보드가 수면 SpO2 결측 시 주간값으로 조용히 폴백하던 문제.
//
// Run: npx tsx scripts/test-spo2-format.ts

import { fmtSpO2, formatEpochKST } from "@/lib/format";
import {
  comparablePrevSpO2,
  resolveSpO2Source,
  resolveSpO2Value,
  spo2CardLabel,
  validSpO2,
} from "@/lib/spo2-source";

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

console.log("\n== validSpO2: (0,100] 밖은 sentinel ==");
// DailySummary.avgSpo2 는 ingest 에서 toFloat 로 저장돼 0 이 그대로 들어올 수 있다
// (SleepRecord.avgSpO2 는 fetchers/sleep-spo2.ts 에서 이미 걸러짐). 표시 직전 방어.
assert("94 → 94", validSpO2(94) === 94);
assert("100 → 100 (경계 포함)", validSpO2(100) === 100);
assert("0 → null (sentinel)", validSpO2(0) === null);
assert("-1 → null", validSpO2(-1) === null);
assert("101 → null", validSpO2(101) === null);
assert("NaN → null", validSpO2(NaN) === null);
assert("null → null", validSpO2(null) === null);
assert("undefined → null", validSpO2(undefined) === null);

console.log("\n== SpO2 출처 판정 (프로덕션 모듈 직접 검증) ==");
assert("수면값 존재 → sleep", resolveSpO2Source(94, 91) === "sleep");
assert("수면 결측 + 주간 존재 → daily", resolveSpO2Source(null, 91) === "daily");
assert("둘 다 결측 → null", resolveSpO2Source(null, null) === null);
assert(
  "수면값 0 은 sentinel → 주간으로 폴백",
  resolveSpO2Source(0, 91) === "daily",
  String(resolveSpO2Source(0, 91)),
);
assert(
  "주간값도 0 이면 → null (0% 표시 방지)",
  resolveSpO2Source(null, 0) === null,
  String(resolveSpO2Source(null, 0)),
);

console.log("\n== 표시 값 ==");
assert("수면값 우선", resolveSpO2Value(94, 91) === 94);
assert("수면 결측 → 주간", resolveSpO2Value(null, 91) === 91);
assert("수면 0 → 주간", resolveSpO2Value(0, 91) === 91);
assert("둘 다 무효 → null", resolveSpO2Value(0, 0) === null);

console.log("\n== 카드 라벨 ==");
assert("sleep → 'SpO2'", spo2CardLabel("sleep") === "SpO2");
assert("daily → 'SpO2 (주간)'", spo2CardLabel("daily") === "SpO2 (주간)");
assert("null → 'SpO2'", spo2CardLabel(null) === "SpO2");

console.log("\n== delta 비교 규칙 (출처 불일치 시 생략) ==");
assert("sleep/sleep → 92", comparablePrevSpO2("sleep", "sleep", 92) === 92);
assert("daily/daily → 92", comparablePrevSpO2("daily", "daily", 92) === 92);
assert(
  "sleep/daily → null (측정 종류가 다름)",
  comparablePrevSpO2("sleep", "daily", 92) === null,
);
assert("daily/sleep → null", comparablePrevSpO2("daily", "sleep", 92) === null);
assert("어제 값 없음 → null", comparablePrevSpO2("sleep", "sleep", null) === null);
assert(
  "오늘 출처가 null 이면 비교 불가",
  comparablePrevSpO2(null, null, 92) === null,
);

console.log("\n== formatEpochKST: Date tick 정규화 (Codex P1 회귀) ==");
{
  // 회귀: Recharts scale="time" 축은 d3 scaleTime 을 쓰고 .ticks() 가 Date 를 반환한다.
  // 숫자로 가정하고 `value + 9h` 하면 Date + number 가 문자열 결합이 되어 오프셋이
  // 사라지고 축이 UTC 로 표시됐다 (헤더는 KST → 9시간 불일치).
  const ms = Date.UTC(2026, 3, 1, 15, 0, 0); // = 2026-04-02 00:00 KST
  assert("number 입력 → '00:00'", formatEpochKST(ms) === "00:00", formatEpochKST(ms));
  assert(
    "Date 입력도 동일하게 '00:00' (UTC '15:00' 아님)",
    formatEpochKST(new Date(ms)) === "00:00",
    formatEpochKST(new Date(ms)),
  );
  assert(
    "number 와 Date 결과 일치",
    formatEpochKST(ms) === formatEpochKST(new Date(ms)),
  );
}
{
  const ms = Date.UTC(2026, 3, 1, 14, 34, 0); // = 23:34 KST
  assert("14:34 UTC → 23:34 KST", formatEpochKST(ms) === "23:34", formatEpochKST(ms));
  assert(
    "Date 로도 23:34",
    formatEpochKST(new Date(ms)) === "23:34",
    formatEpochKST(new Date(ms)),
  );
}
{
  // 날짜 경계 넘김
  const ms = Date.UTC(2026, 3, 1, 16, 30, 0); // = 다음날 01:30 KST
  assert("자정 넘김 → 01:30", formatEpochKST(ms) === "01:30", formatEpochKST(ms));
}
assert("숫자 문자열도 처리", formatEpochKST(String(Date.UTC(2026, 3, 1, 15, 0, 0))) === "00:00");
assert("NaN → '-'", formatEpochKST(NaN) === "-");
assert("Invalid Date → '-'", formatEpochKST(new Date("nope")) === "-");
assert("파싱 불가 문자열 → '-'", formatEpochKST("nope") === "-");

console.log(failures === 0 ? "\n✅ 전체 통과" : `\n❌ 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
