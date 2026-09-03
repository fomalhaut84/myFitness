# 식단 편집 프롬프트 force_reply 제거 — chat 단위 pending 전환

- **작성일**: 2026-09-03
- **타입**: fix
- **이슈**: #350

## 1. 배경

텔레그램에서 식단 로그의 `[🔢 kcal]` / `[📝 설명]` 버튼을 눌러 수정한 뒤, **답장 입력폼이 사라지지 않고 채팅방을 열 때마다 같은 항목으로 계속 재생성**되는 문제. 입력창의 ✕ 를 눌러도 다음에 채팅방을 열면 다시 나타난다.

### 원인

`force_reply` 는 Telegram **클라이언트 측 상태**다. 프롬프트 메시지를 수신하면 클라이언트가 "이 메시지에 답장 대기중" 상태를 채팅방에 저장하고, 다음 두 경우에만 해제된다.

1. 그 메시지에 실제로 답장을 보냄
2. 그 메시지가 채팅방에서 사라짐

✕ 탭은 현재 화면에서 답장 바를 내릴 뿐 저장된 상태를 지우지 않아, 채팅방 재진입 시 다시 무장된다. Bot API 에는 이미 보낸 force_reply 를 회수하는 메서드가 없다 (`editMessageReplyMarkup` / `editMessageText` 의 `reply_markup` 은 InlineKeyboardMarkup 만 허용).

서버는 `food-edit-state.ts` 의 5분 TTL 로 in-memory pending 만 만료시키고 클라이언트에는 아무 신호도 보내지 않는다. 따라서 봇 입장에서 "끝난" 편집이어도 클라이언트는 영구히 대기 상태로 남는다.

### 답장 안 된 프롬프트가 쌓이는 경로

| # | 경로 | 위치 |
|---|---|---|
| 1 | 프롬프트 발송 후에도 원본 메시지의 `[🔢 kcal]` `[📝 설명]` 버튼이 남아 재탭 가능 → 프롬프트 N개, 답장 1개 | `food-edit-callback.ts:162-190` |
| 2 | 검증 실패 시 `reissueForRetry` 가 새 force_reply 발송, 이전 프롬프트는 방치 | `food-edit-callback.ts:236-245`, `:322-335` |
| 3 | 프롬프트만 띄우고 답장 안 함 (5분 TTL 만료) — 서버만 만료, 클라이언트는 영구 잔존 | `food-edit-state.ts` |
| 4 | 봇 재시작 (PM2 배포) 으로 in-memory Map 소실 — 채팅방의 프롬프트 메시지는 그대로 | 〃 |

`src/` 전체에서 force_reply 발송 지점은 `food-edit-callback.ts` 뿐이며 모두 사용자 콜백 트리거다. cron·리포트·재시작 경로의 재발송은 없음 — 봇이 다시 보내는 것이 아니라 채팅방에 남은 프롬프트 메시지가 계속 입력폼을 재무장시키는 것.

### 기각안: 프롬프트 메시지 삭제

`deleteMessage` 로 프롬프트를 회수하면 해결되지만, 봇이 대화 기록을 지우는 부작용이 원인보다 크다. **기각.**

## 2. 목표

force_reply 를 제거하고 **chat 단위 pending 상태**로 전환해, 클라이언트에 끈적한(sticky) 상태를 애초에 만들지 않는다. 프롬프트 메시지는 일반 메시지로 대화 기록에 그대로 남는다.

## 3. 요구사항

- [ ] F1: 편집 프롬프트를 force_reply 없는 일반 메시지로 발송
- [ ] F2: pending key 를 `(chatId, promptMessageId)` → `chatId` 로 변경, 라우팅을 `reply_to_message` → 다음 일반 텍스트로 전환
- [ ] F3: chat 당 pending 1건만 유지 — 버튼 재탭 시 덮어쓰기 (스태킹 불가)
- [ ] F4: 프롬프트에 `[✕ 취소]` inline 버튼 추가 (현재 중단 수단 부재)
- [ ] F5: 슬래시 명령(`/`로 시작)은 편집 입력으로 소비하지 않음
- [ ] F6: grace tombstone 제거 — 만료 시 일반 라우팅으로 통과
- [ ] F7: 완료/취소 메시지에 `remove_keyboard` 부착 — 기존에 박힌 force_reply 상태 정리 시도
- [ ] F8: 상태 머신 회귀 검증 스크립트 추가
- [ ] F9: 검증 실패 재프롬프트 횟수 상한 — pending 무한 지속 차단 (사전 리뷰 P1)
- [ ] F10: 설명 변경 성공 응답에 이전 설명 노출 — 오소비 복구 경로 (사전 리뷰 P1)

## 4. 기술 설계

### 4.1 `food-edit-state.ts` — chat 단위 재설계

```
현재: Map<`${chatId}:${promptMessageId}`, { logId, action, activeUntil }>
변경: Map<chatId,                        { logId, action, activeUntil }>
```

API:

| 함수 | 시그니처 | 비고 |
|---|---|---|
| `markPendingEdit` | `(chatId, logId, action = "kcal")` | 기존 pending 덮어쓰기. 재시도 카운터 리셋 |
| `registerRetry` | `(chatId) => boolean` | 재프롬프트 직전 호출. 여력 있으면 TTL 갱신 후 true, 한도 초과 시 pending 삭제 후 false |
| `shouldConsumeAsEditInput` | `(chatId, text) => boolean` | `index.ts` 라우팅 판단. 슬래시 텍스트 배제 + pending 확인 |
| `isPendingEdit` | `(chatId) => boolean` | 만료 시 lazy delete 후 false |
| `peekPendingEdit` | `(chatId) => { logId, action } \| null` | 만료 시 lazy delete 후 null |
| `deletePendingEdit` | `(chatId)` | 성공/취소 시 소비 |
| `clearPendingEditFor` | `(chatId, logId) => boolean` | 취소 전용. logId 불일치 시 no-op |

**grace tombstone 제거 근거**: reply-to 라우팅에서는 사용자가 프롬프트에 *명시적으로 답장*했을 때만 tombstone 이 히트해 안전했다. chat 단위 라우팅에서 25분 tombstone 을 유지하면 **만료 후 30분간 그 채팅의 모든 텍스트가 "만료되었습니다" 안내로 먹힌다.** 만료 시 그냥 삭제하고 일반 라우팅으로 통과시킨다. TTL 은 5분 유지, 프롬프트 문구에 시한 명시.

`clearPendingEditFor` 의 logId 대조: 오래된 프롬프트의 `[✕ 취소]` 를 나중에 눌렀을 때 그 사이 시작된 **다른** 편집을 취소하지 않기 위함.

**재프롬프트 상한 (F9, 사전 리뷰 P1)**: 검증 실패 시 `markPendingEdit` 으로 TTL 을 갱신하면 chat 단위 라우팅에서는 *아무 텍스트나* 재프롬프트를 유발하므로 pending 이 영원히 만료되지 않고 chat 의 모든 텍스트를 삼킨다 (reply-to 라우팅에서는 명시적 답장에만 걸려 안전했던 전제). `registerRetry` 로 3회 상한을 두고, 초과 시 pending 을 종료하며 안내한다. `markPendingEdit`(버튼 재탭 = 새 편집) 은 카운터를 리셋한다.

**라우팅 판단 추출 (사전 리뷰 P0)**: 소비 조건을 `index.ts` 인라인에 두면 회귀 스크립트가 커버할 수 없어 `shouldConsumeAsEditInput` 으로 분리했다.

### 4.2 `food-edit-callback.ts`

- `parseCallbackData` 에 `edit-cancel` action 추가 (`food:edit-cancel:<logId>`, 17+25=42byte < 64 안전)
- 프롬프트 발송: `reply_markup: { force_reply, input_field_placeholder }` → `InlineKeyboard().text("✕ 취소", ...)`
- `handleFoodEditReply` → **`handleFoodEditInput`** 으로 개명 (더 이상 reply 아님). `ctx.message.reply_to_message` 의존 제거
- `reissueForRetry`: 새 프롬프트 message_id 재바인딩 로직 삭제 → 일반 메시지 발송 + `markPendingEdit` 으로 TTL 갱신
- 취소 핸들러: `clearPendingEditFor` → `answerCallbackQuery` → `editMessageReplyMarkup({ reply_markup: undefined })` 로 취소 버튼 제거
- 완료/취소 메시지에 `reply_markup: { remove_keyboard: true }`
- `delete` 콜백에서 같은 로그의 pending 정리 (사전 리뷰 P0) — 프롬프트를 띄운 채 삭제하면 pending 이 남아 이후 텍스트를 삼킨다. 대상 로그가 사라진 것이 확정된 **두 경로** (삭제 성공 · `P2025` 이미 삭제됨) 를 단일 cleanup 지점으로 합쳐 분기 누락을 구조적으로 차단 (Codex P2). DB 오류 경로는 로그 존재가 불확실하므로 pending 을 유지해 재시도를 허용
- **F10**: `handleDescReply` 성공 응답에 이전 설명 노출. desc 경로는 임의 텍스트가 그대로 `description` 이 되고 같은 update 로 kcal/매크로/items 가 전부 null 로 파기되어, kcal 경로(숫자 검증 + `applyKcalCorrection`)와 달리 비대칭적으로 파괴적이다. 오소비 판별 대신 **복구 가능성**을 보장한다

원본 메시지의 `[🔢 kcal] [📝 설명] [🗑️ 삭제]` 키보드는 **유지**한다. chat 단위 pending 은 재탭 시 덮어쓰므로 스태킹이 발생하지 않고, 버튼이 남아있는 편이 UX 상 낫다.

### 4.3 `index.ts` 라우팅 순서

```
1. /food_kcal 명령                        (명령이 pending 보다 우선)
2. shouldConsumeAsEditInput(chatId, text) → handleFoodEditInput
3. isFoodInput                            → handleFoodInput
4. fallback                               → handleAiQuestion
```

F5 의 `/` 가드가 없으면 pending 중 미등록 슬래시 명령이 kcal 값으로 소비된다. 등록된 명령(`/today` 등)은 grammy command 핸들러가 먼저 잡아 `message:text` 까지 오지 않는다.

만료 후에는 안내 없이 일반 라우팅으로 통과한다. `isFoodInput` 은 `^(아침|조식|점심|중식|저녁|석식|간식|야식)` 접두사만 매칭하므로 `650` 같은 잔여 입력이 식단으로 오탐되지 않고 AI 질문으로 흘러간다 — 수용 가능한 영향.

### 4.4 응답 메시지 길이 · 커밋 이후 전송 (Codex P2, PR #351)

`FoodLog.description` 은 스키마에 길이 제한이 없다 (PATCH API 만 500자 제한, 생성·Vision 경로는 무제한). F10 으로 이전 설명까지 함께 실으면서 완료 응답이 Telegram 한도(4096자)를 넘길 수 있게 됐다. 넘기면 `sendMessage` 가 거부되는데, **그 시점엔 DB update 와 `deletePendingEdit` 이 이미 끝난 뒤**라 catch 가 반영된 수정을 "설명 수정 중 오류" 로 오인 보고하고 복구 안내까지 유실된다.

두 가지를 함께 고친다.

1. 메시지에 삽입하는 설명을 `descPreview` 로 120자 절단. 조립 로직을 의존성 없는 `food-edit-format.ts` 로 분리해 회귀 스크립트가 최악값 길이를 검증한다.
2. **커밋 이후 전송을 try 밖으로 이동** (kcal·desc 양쪽). 전송 실패가 DB 작업 실패로 오인 보고되지 않는다.

### 4.5 트레이드오프

pending 중 무관한 텍스트가 편집 입력으로 먹힌다. 완화: `[✕ 취소]` 버튼, 5분 TTL, 검증 실패 시 재프롬프트 유지. 사용자 1명·단일 chat 이므로 reply-to 로 대상을 구분할 실익이 없고, 긴 식별자 타이핑 회피(#292 의 원 목적)는 chat pending 에서도 동일하게 달성된다.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/bot/commands/food-edit-state.ts` | chat 단위 재설계, grace 제거, `clearPendingEditFor` 추가 |
| `src/bot/commands/food-edit-callback.ts` | force_reply 제거, 취소 액션, `handleFoodEditInput` 개명 |
| `src/bot/index.ts` | 라우팅 조건 변경 + `/` 가드 |
| `src/bot/commands/food-edit-format.ts` | 신규 — 응답 메시지 조립 (의존성 없는 순수 모듈) |
| `scripts/verify-food-edit-pending.ts` | 신규 — 상태 머신 · 라우팅 · 메시지 길이 회귀 검증 |
| `package.json` | `verify:food-edit-pending` 스크립트 추가 |
| `docs/specs/350-food-edit-force-reply-fix.md` | 본 문서 |

## 6. 테스트 계획

테스트 프레임워크 부재 → workflow.md 8-5 에 따라 재현/검증 스크립트로 대체.

`scripts/verify-food-edit-pending.ts` (`npx tsx`):

- C1: mark → `isPendingEdit` true, `peekPendingEdit` 이 logId/action 반환
- C2: **버튼 2회 탭** → entry 1건만 유지, 최신 logId 로 덮어쓰기 (스태킹 회귀 방지)
- C3: TTL 경과 → `isPendingEdit` false, `peekPendingEdit` null, Map 에서 제거 (lazy delete)
- C4: `registerRetry` — 한도 내 TTL 갱신, 3회 초과 시 pending 종료. **시간을 계속 흘려도 재시도만으로 pending 이 무한 연장되지 않음** (사전 리뷰 P1 회귀)
- C4b: `markPendingEdit`(버튼 재탭) 이 재시도 카운터 리셋
- C5: `clearPendingEditFor` logId 불일치 → pending 유지, 일치 → 삭제
- C6: 서로 다른 chatId 간 격리
- C7: `shouldConsumeAsEditInput` — pending 없음/만료/슬래시 텍스트/타 chat 에서 false
- C8: 완료 응답이 Telegram 4096자 한도 이내 (Codex P2 회귀). `descPreview` 절단/경계값, 이전·새 설명을 모두 10,000자로 준 최악값 검증

3-check: `npm run lint && npm run typecheck && npm run build`

### 스크립트로 커버 불가한 시나리오 (배포 후 실사용 검증)

grammy `ctx` · Prisma 를 함께 mock 해야 하는 콜백 흐름은 프레임워크 없이 검증할 수 없어 재현 절차를 명시한다.

| # | 재현 | 기대 |
|---|---|---|
| M1 | 식단 수정 완료 → 앱 종료 → 재진입 | 답장 입력폼 미재생성 |
| M2 | `[🔢 kcal]` → `[✕ 취소]` | pending 종료, 이후 텍스트가 정상 라우팅 |
| M3 | `[🔢 kcal]` 대기 중 `/today` | 명령으로 처리 (kcal 값으로 소비 안 됨) |
| M4 | `[🔢 kcal]` 대기 중 비숫자 텍스트 4회 | 3회까지 재프롬프트, 4회째 편집 종료 안내 (F9) |
| M5 | **Codex P2 회귀** — `[🔢 kcal]` 프롬프트 대기 중 웹 API 로 해당 로그 삭제 → 봇의 `[🗑️ 삭제]` 탭 → 아무 텍스트 입력 | `P2025` 경로에서도 pending 이 정리되어, 입력이 편집으로 가로채이지 않고 정상 라우팅 |
| M6 | `[📝 설명]` 로 설명 변경 | 응답에 이전 설명 표시 (F10 복구 경로) |
| M7 | 긴 설명(수백 자)의 로그를 `[📝 설명]` 로 변경 | 응답이 미리보기로 잘려 정상 전송, "수정 중 오류" 오보 없음 |

## 7. 제외 사항

- 프롬프트 메시지 삭제 (`deleteMessage`) — 대화 기록 훼손으로 기각
- 이미 클라이언트에 박힌 force_reply 의 확정적 제거 — Bot API 에 회수 수단 없음. F7 의 `remove_keyboard` 는 best-effort 이며, 실패 시 사용자가 해당 프롬프트에 답장하거나 메시지를 직접 삭제해야 함
- pending 중 무관 텍스트 오소비에 대한 휴리스틱 판별 (형식 추측 기반 분기) — 취약해서 도입하지 않음. desc 경로는 F10 의 복구 경로로 완화
- 취소 버튼의 epoch/nonce 대조 (사전 리뷰 P0) — 같은 로그를 편집 완료 후 다시 편집할 때, 스크롤을 올려 예전 프롬프트의 `[✕ 취소]` 를 누르면 진행 중인 새 편집이 취소된다. 실사용 확률이 낮고 결과도 무해한 취소이므로 후속 이슈로 분리
- 다중 사용자/다중 chat 동시 편집 시나리오 — 단일 사용자 전제
