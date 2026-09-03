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
  registerRetry,
  shouldConsumeAsEditInput,
} from "../src/bot/commands/food-edit-state";
import {
  DESC_PREVIEW_MAX,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  buildDescChangeMessage,
  buildKcalChangeMessage,
  descPreview,
} from "../src/bot/commands/food-edit-format";

const ACTIVE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

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

// C4: 재프롬프트는 TTL 을 갱신하되 횟수 상한이 있다 (사전 리뷰 P1 회귀)
//   상한이 없으면 kcal 프롬프트를 잊고 대화를 이어갈 때 pending 이 영원히 만료되지 않고
//   chat 의 모든 텍스트를 삼킨다.
console.log("C4: registerRetry — TTL 갱신 + 횟수 상한");
reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
withClockAdvancedBy(ACTIVE_TTL_MS - 1_000, () => {
  check("한도 내 재시도는 true", registerRetry(CHAT_A) === true);
});
withClockAdvancedBy(ACTIVE_TTL_MS + 1_000, () => {
  check("갱신 덕분에 원 만료 시점 이후에도 유효", isPendingEdit(CHAT_A) === true);
});

reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
for (let i = 1; i <= MAX_RETRIES; i += 1) {
  check(`재시도 ${i}회차 허용`, registerRetry(CHAT_A) === true);
}
check("한도 초과 재시도는 false", registerRetry(CHAT_A) === false);
check("한도 초과 시 pending 종료", isPendingEdit(CHAT_A) === false);

// 무제한 갱신 회귀: 시간을 계속 흘려도 재시도만으로는 pending 을 영구 유지할 수 없다.
reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
let survived = 0;
for (let i = 0; i < 100; i += 1) {
  const ok = withClockAdvancedBy(i * (ACTIVE_TTL_MS - 1_000), () =>
    registerRetry(CHAT_A),
  );
  if (!ok) break;
  survived += 1;
}
check(`재시도로 무한 연장 불가 (${survived}회에서 종료)`, survived === MAX_RETRIES);
check("무한 연장 시도 후 pending 없음", isPendingEdit(CHAT_A) === false);

check("pending 없을 때 registerRetry false", registerRetry(CHAT_B) === false);

// C4b: 새 편집 시작은 재시도 카운터를 리셋
console.log("C4b: markPendingEdit 이 재시도 카운터 리셋");
reset();
markPendingEdit(CHAT_A, "log-1", "kcal");
for (let i = 0; i < MAX_RETRIES; i += 1) registerRetry(CHAT_A);
markPendingEdit(CHAT_A, "log-1", "kcal"); // 버튼 재탭 = 새 편집
check("리셋 후 다시 재시도 가능", registerRetry(CHAT_A) === true);

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

// C7: 라우팅 판단 — bot/index.ts message:text 가 이 텍스트를 편집 입력으로 소비할지
//   (사전 리뷰 P0: index.ts 인라인 조건이면 검증 불가라 함수로 추출)
console.log("C7: shouldConsumeAsEditInput 라우팅 규칙");
reset();
check("pending 없으면 소비 안 함", shouldConsumeAsEditInput(CHAT_A, "650") === false);
markPendingEdit(CHAT_A, "log-1", "kcal");
check("pending 있으면 일반 텍스트 소비", shouldConsumeAsEditInput(CHAT_A, "650") === true);
check(
  "슬래시 명령은 소비하지 않음 (/today 오소비 방지)",
  shouldConsumeAsEditInput(CHAT_A, "/today") === false,
);
check(
  "미등록 슬래시 명령도 소비하지 않음",
  shouldConsumeAsEditInput(CHAT_A, "/foo bar") === false,
);
check(
  "다른 chat 은 영향 없음",
  shouldConsumeAsEditInput(CHAT_B, "650") === false,
);
withClockAdvancedBy(ACTIVE_TTL_MS + 1_000, () => {
  check("만료 후 소비 안 함 (일반 라우팅 통과)", shouldConsumeAsEditInput(CHAT_A, "650") === false);
});

// C8: 응답 메시지 길이 — Telegram 4096자 한도 (Codex P2 PR #351 회귀)
//   description 컬럼에 길이 제한이 없어, 이전 설명과 새 설명을 함께 실으면 완료 응답이
//   한도를 넘어 sendMessage 가 거부됐다. 그 시점엔 DB update 가 이미 커밋된 뒤라
//   사용자는 복구 안내를 잃고 수정이 실패한 것으로 오인한다.
console.log("C8: 완료 응답이 Telegram 메시지 한도 이내");
const HUGE = "가".repeat(10_000);
check(
  `descPreview 가 ${DESC_PREVIEW_MAX}자 + 말줄임표로 절단`,
  descPreview(HUGE).length === DESC_PREVIEW_MAX + 1,
);
check("한도 이하 설명은 그대로", descPreview("김치찌개") === "김치찌개");
check(
  `경계값 ${DESC_PREVIEW_MAX}자는 절단하지 않음`,
  descPreview("가".repeat(DESC_PREVIEW_MAX)).length === DESC_PREVIEW_MAX,
);

const worstDesc = buildDescChangeMessage(HUGE, HUGE);
check(
  `설명 변경 완료 응답 최악값 ${worstDesc.length}자 < ${TELEGRAM_MAX_MESSAGE_LENGTH}`,
  worstDesc.length < TELEGRAM_MAX_MESSAGE_LENGTH,
);
check("이전 설명이 응답에 포함 (복구 경로 F10)", worstDesc.includes("이전 설명"));

const worstKcal = buildKcalChangeMessage(HUGE, 10_000);
check(
  `kcal 완료 응답 최악값 ${worstKcal.length}자 < ${TELEGRAM_MAX_MESSAGE_LENGTH}`,
  worstKcal.length < TELEGRAM_MAX_MESSAGE_LENGTH,
);

reset();
if (failed > 0) {
  console.error(`\n❌ ${failed}건 실패`);
  process.exit(1);
}
console.log("\n✅ 전체 통과");
process.exit(0);
