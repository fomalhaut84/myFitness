/**
 * #350 회귀 검증 — 식단 편집 pending 상태 머신.
 *
 * 배경: force_reply 는 Telegram 클라이언트 상태라 답장 안 된 프롬프트가 채팅방을 열 때마다
 * 답장 입력폼을 영구 재무장시켰다. chat 단위 pending 으로 전환하며 이 스크립트로 상태 머신을
 * 검증한다. 프로젝트에 테스트 프레임워크가 없어 workflow.md 8-5 에 따라 스크립트로 대체.
 *
 * 실행: npx tsx scripts/verify-food-edit-pending.ts
 */

import {
  clearPendingEditFor,
  deletePendingEdit,
  isPendingEdit,
  markPendingEdit,
  peekPendingEdit,
} from "../src/bot/commands/food-edit-state";

const ACTIVE_TTL_MS = 5 * 60 * 1000;

const CHAT_A = 1001;
const CHAT_B = 2002;

let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`);
    failed += 1;
  }
}

/** Date.now 를 offsetMs 만큼 앞당긴 상태로 fn 실행 (TTL 경과 시뮬레이션). */
function withClockAdvancedBy<T>(offsetMs: number, fn: () => T): T {
  const realNow = Date.now;
  Date.now = () => realNow() + offsetMs;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

function reset(): void {
  deletePendingEdit(CHAT_A);
  deletePendingEdit(CHAT_B);
}

// C1: mark → peek 이 logId/action 반환
console.log("C1: mark → isPendingEdit / peekPendingEdit");
reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
check("isPendingEdit true", isPendingEdit(CHAT_A) === true);
check("peek logId=log-1", peekPendingEdit(CHAT_A)?.logId === "log-1");
check("peek action=kcal", peekPendingEdit(CHAT_A)?.action === "kcal");
check("peek 는 소비하지 않음", isPendingEdit(CHAT_A) === true);

// C2: 버튼 2회 탭 → 스태킹 없이 최신 항목으로 덮어쓰기 (#350 핵심 회귀)
console.log("C2: 버튼 2회 탭 → pending 1건만 유지 (스태킹 회귀 방지)");
reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
markPendingEdit(CHAT_A, "log-2", "desc");
check("최신 logId=log-2 로 덮어쓰기", peekPendingEdit(CHAT_A)?.logId === "log-2");
check("최신 action=desc 로 덮어쓰기", peekPendingEdit(CHAT_A)?.action === "desc");
check(
  "이전 logId 의 취소는 no-op (오래된 프롬프트가 신규 편집을 취소하지 않음)",
  clearPendingEditFor(CHAT_A, "log-1") === false,
);
check("취소 no-op 후에도 pending 유지", isPendingEdit(CHAT_A) === true);

// C3: TTL 경과 → lazy delete 후 통과 (grace tombstone 제거 확인)
console.log("C3: TTL 경과 → isPendingEdit false, peek null");
reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
withClockAdvancedBy(ACTIVE_TTL_MS + 1_000, () => {
  check("만료 후 isPendingEdit false", isPendingEdit(CHAT_A) === false);
  check("만료 후 peek null", peekPendingEdit(CHAT_A) === null);
});
check(
  "만료 entry 는 lazy delete — 시계 복원 후에도 되살아나지 않음",
  isPendingEdit(CHAT_A) === false,
);

// C4: 재프롬프트가 TTL 을 갱신 (검증 실패 후 재입력 창 확보)
console.log("C4: 재프롬프트 markPendingEdit 이 TTL 갱신");
reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
withClockAdvancedBy(ACTIVE_TTL_MS - 1_000, () => {
  markPendingEdit(CHAT_A, "log-1", "kcal"); // 검증 실패 → 재프롬프트
});
withClockAdvancedBy(ACTIVE_TTL_MS + 1_000, () => {
  check("갱신 덕분에 원 만료 시점 이후에도 유효", isPendingEdit(CHAT_A) === true);
});

// C5: 취소 — logId 일치 시에만 삭제
console.log("C5: clearPendingEditFor logId 대조");
reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
check("불일치 logId → false", clearPendingEditFor(CHAT_A, "other") === false);
check("불일치 후 pending 유지", isPendingEdit(CHAT_A) === true);
check("일치 logId → true", clearPendingEditFor(CHAT_A, "log-1") === true);
check("일치 후 pending 삭제", isPendingEdit(CHAT_A) === false);
check("이미 없는 pending 취소 → false", clearPendingEditFor(CHAT_A, "log-1") === false);

// C6: chat 간 격리
console.log("C6: chatId 간 격리");
reset();
markPendingEdit(CHAT_A, "log-a", "kcal");
markPendingEdit(CHAT_B, "log-b", "desc");
check("CHAT_A 는 log-a", peekPendingEdit(CHAT_A)?.logId === "log-a");
check("CHAT_B 는 log-b", peekPendingEdit(CHAT_B)?.logId === "log-b");
deletePendingEdit(CHAT_A);
check("CHAT_A 삭제해도 CHAT_B 유지", isPendingEdit(CHAT_B) === true);

reset();
if (failed > 0) {
  console.error(`\n❌ ${failed}건 실패`);
  process.exit(1);
}
console.log("\n✅ 전체 통과");
process.exit(0);
