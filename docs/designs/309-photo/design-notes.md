# #309 사진 등록 — 디자인 노트

## 배치 결정

- 웹은 현재 read-only (텍스트 로그는 봇 담당). 이 스코프는 **사진 등록만** 추가.
- `/lifestyle` → `TodayFoodSection` 헤더 우측에 **📷 사진 등록** 컴팩트 버튼 배치.
- 별도 페이지/모달 회피 → 컨텍스트 유지, 클릭 → 파일 선택 (모바일 카메라) → 리스트에 신규 row.

## 컴포넌트 & 상태

`FoodPhotoUpload` (신규 client 컴포넌트) 를 `TodayFoodSection` 헤더에 삽입.

State machine:
- **idle** — 버튼만 (호버 시 border 강조)
- **uploading** — 버튼 disabled + spinner + 파일명 + "AI 분석 중… (~30초)"
- **success** — 초록 배너 (`✓ 사진 분석 완료 · <desc> (770 kcal)`) 3s 표시 후 사라짐 + router.refresh() 로 새 row 갱신
- **error** — 빨간 배너 (`✗ Vision 분석 실패 · 다시 시도해주세요`) + subtext 로 원인/대안

## 스타일

- 버튼: `bg linear-gradient(180deg, surface, card)`, `border 1px solid var(--border)`, `radius 8px`, `padding 6px 12px`. 호버 시 border-muted, bg-surface.
- 상태 배너: uploading (amber warm), success (green), error (red). font-size 12px. 파일명 굵게.
- 신규 row 강조: 초록 배경 tint (rgba(34,197,94,.05)) + `NEW` 태그 (letter-spacing 넓은 uppercase).

## 접근성 / UX

- 파일 input 은 hidden, 버튼 클릭 → `input.click()` 트리거.
- `capture="environment"` 로 모바일 브라우저는 카메라 즉시 실행.
- 업로드 실패 시 파일 재선택 없이 재시도 어려움 → 사용자에게 "다시 시도" 명시.
- 큰 이미지는 client 에서 `<canvas>` 로 downscale (max 1600px, JPEG q=0.85) 후 upload.

## Description 정정 UI (추가 스코프)

**웹 (`/lifestyle` FoodRow)**
- 각 row 우측에 아이콘 3개: `✏️` (kcal — 기존) · `📝` (설명 — 신규) · `🗑️` (삭제 — 기존)
- `📝` 클릭 → inline text input (현재 description pre-fill) + `저장` / `취소` 버튼
- 저장 시 PATCH `/api/food/[id] { description: newValue }` → macros/attempts clear (기존 로직 재사용) → router.refresh
- 새 desc 는 backfill 이 재추정 (`nutritionAttempts` null 로 리셋되어 다음 tick 대상)

**봇**
- 기존 keyboard: `[✏️ 수정] [🗑️ 삭제]` → 신규: `[🔢 kcal] [📝 설명] [🗑️ 삭제]`
- `📝 설명` 콜백: `${CALLBACK_PREFIX}:edit-desc:${logId}` → force_reply prompt ("새 설명을 텍스트로 답장해주세요") → 답장 텍스트로 PATCH description
- pending state 는 기존 food-edit-state 재활용 (action 필드 추가하거나 별도 key)

## 스코프 밖 (Phase 3+)

- 웹에서 텍스트로 로그 등록 (봇 담당 유지)
- 사진 preview 표시 (등록 후 이미지 저장 안 하므로 preview 있어도 짧은 시간만 유효)
- 여러 장 동시 업로드
