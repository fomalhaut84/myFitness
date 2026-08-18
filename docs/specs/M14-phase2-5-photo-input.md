# M14 Phase 2 #5 — 사진 입력 (Claude Vision)

- **이슈**: [#309](https://github.com/fomalhaut84/myFitness/issues/309)
- **의존**: #299 (완료) — P/C/F macros 저장 스키마 재사용
- **관련 스펙**: [`M14-food-tracking-ai-kcal.md`](./M14-food-tracking-ai-kcal.md)

## 목적

사용자가 봇/웹에서 음식 **사진** 을 첨부하면 Claude Vision 이 항목·kcal·P/C/F 를 자동 추정해 FoodLog 로 저장. 타이핑 없이 로그 등록 → 모바일 UX 대폭 개선.

## 요구사항

**추가 (사용자 요청 2026-08-18)**: description 오인식 정정 UI 도 이번 스코프. 사진 오인식 (예: 치킨 샐러드 → 스테이크 샐러드) 을 삭제·재촬영 없이 정정 가능. Codex 리뷰 (PR #300 14회차) 에서도 지적된 "backfill terminal notice 가 실제로 트리거할 UI 없음" 이슈 해결.


- [ ] Claude CLI 기반 vision estimator (`estimateNutritionFromPhoto`)
  - 입력: `imagePath` (로컬 temp 파일) + optional `caption`, `mealType`
  - 출력: 기존 `NutritionEstimate` shape 재사용 (kcal · P · C · F · items · confidence · notes)
  - item 별 4·4·9 검증, 부분 macros null-propagate (텍스트 estimator 와 동일 규칙)
- [ ] 봇 photo handler (`src/bot/commands/food.ts` 확장 or 별도 파일)
  - `message:photo` 수신 → 가장 큰 사이즈 downloading → temp 파일 저장
  - 캡션이 있으면 description 으로 활용 (없으면 Vision 응답의 첫 item 이름/summary 사용)
  - Vision 호출 → FoodLog 저장 → inline `[수정][삭제]` 답장 (기존 UX 재사용)
  - Vision 응답 실패 시 log 저장은 유지 (`estimatedKcal=null` → backfill 대상 X, description 필요)
- [ ] 웹 UI 사진 첨부 (신규 · 웹은 현재 read-only)
  - `/lifestyle` 페이지 `TodayFoodSection` 헤더에 `📷 사진 등록` 버튼 (텍스트 입력은 봇 담당 유지)
  - `<input type="file" accept="image/*" capture="environment">` (모바일 카메라 즉시 호출)
  - 업로드 상태 (idle → uploading spinner → success/error) inline 표시 후 router.refresh
  - `POST /api/food` multipart/form-data 지원 확장 (기존 JSON 경로 유지)
- [ ] 원본 이미지 저장 안 함 — Vision 응답만 FoodLog 에 저장, 이미지는 처리 후 즉시 삭제
- [ ] **Description 정정 UI (신규 · web + bot)**
  - **웹**: `/lifestyle` FoodRow 에 `📝` 아이콘 → inline text input (현재값 pre-fill) → 저장 시 PATCH `/api/food/[id] { description }`. kcal edit 와 동일 pattern.
  - **봇**: 기존 `[✏️ 수정] [🗑️ 삭제]` inline keyboard 를 `[🔢 kcal] [📝 설명] [🗑️ 삭제]` 3 버튼으로 확장. 별도 callback prefix + force_reply prompt ("새 설명을 텍스트로 답장해주세요").
  - PATCH description 은 이미 macros clear + `nutritionAttempts` reset 처리 (기존 로직 · Codex 24회차 정합성 유지). 새 desc 는 backfill 이 재추정.

## 기술 설계

### Vision estimator (`src/lib/nutrition/estimate-nutrition-photo.ts`)

Claude CLI 는 프롬프트 내 `@<path>` 문법으로 로컬 파일을 읽어 이미지 콘텐츠로 처리.

```ts
export interface NutritionPhotoInput {
  imagePath: string;        // 절대 경로 (temp 파일)
  caption?: string;         // 사용자 부가 설명 (optional)
  mealType?: string;
}

export async function estimateNutritionFromPhoto(
  input: NutritionPhotoInput,
  opts?: EstimateNutritionOptions,
): Promise<NutritionEstimate | null>;
```

프롬프트 예시 (Korean):
```
@/tmp/mfp-photo-abc123.jpg

이 이미지는 음식 사진이야. 각 항목의 이름·양·kcal·P/C/F 를 추정해 JSON 으로 답해줘.
- 형식: (기존 estimate-nutrition 과 동일 스키마)
- item 별 4·4·9 검증
- caption: <caption 있으면 여기에>
- mealType: <있으면 여기에>
```

CLI 호출: `claude -p <prompt> --output-format json --model sonnet --max-turns 1 --tools ""`. `@`-reference 는 tools 무관하게 CLI 가 pre-process. (impl 시 tools 설정 조정 필요할 수 있음.)

### 봇 photo handler

```ts
bot.on("message:photo", async (ctx) => {
  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];      // 가장 큰 사이즈
  const file = await ctx.api.getFile(largest.file_id);
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  // download to temp
  const tmp = path.join(os.tmpdir(), `mfp-photo-${Date.now()}-${largest.file_id.slice(-8)}.jpg`);
  await downloadTo(url, tmp);
  try {
    const caption = ctx.message.caption?.trim();
    const mealType = inferMealTypeFromCaption(caption) ?? guessByTime();
    const estimate = await estimateNutritionFromPhoto({ imagePath: tmp, caption, mealType });
    // FoodLog 저장 · [수정][삭제] 답장 (기존 handleFoodInput 로직 공유)
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
});
```

### 웹 UI 사진 첨부

- `TodayFoodSection` (lifestyle-client.tsx) 헤더에 `📷 사진 등록` 컴팩트 버튼
- File selection → `<canvas>` 로 downscale (max 1600px, JPEG q=0.85 — Vision 비용/속도 최적화)
- 업로드 중 spinner + "AI 분석 중… (~30초)" 안내, 성공 시 `router.refresh()` 로 리스트 갱신
- FormData 로 POST — `{ image: File, description?: string, mealType?: string }`
- 서버 route 는 `Content-Type: multipart/form-data` 감지 시 별도 분기 → temp 저장 → Vision → FoodLog
- 텍스트 입력 (봇 담당) 은 이번 스코프에서 제외

### API route 확장 (`src/app/api/food/route.ts`)

```ts
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    return handlePhotoSubmit(request);   // 신규 분기
  }
  // 기존 JSON 경로 (description 기반) 유지
  ...
}
```

`handlePhotoSubmit`: FormData 파싱 → File → temp 저장 → estimateNutritionFromPhoto → FoodLog 저장 (기존 withSerializableRetry 재사용) → temp 삭제 → 응답.

## 비목표 (Phase 3 이후)

- 이미지 저장/재추정 (사용자가 재검토 원하면 재첨부)
- 여러 장 동시 (한 번에 한 사진만; 다중 항목은 한 사진 내 Vision 이 자체 인식)
- OCR (레시피 패키지 뒷면 nutrition facts 스캔) — 별도 이슈

## 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| Vision 응답 신뢰도 (특히 한식) | item 별 4·4·9 검증 + 사용자 [수정] 로 정정 |
| Timeout (Vision 은 텍스트보다 느림, 10~30s) | timeout 45s 로 상향 (기존 15s → 45s) |
| Temp 파일 leak | try/finally + startup 시 오래된 mfp-photo-* 정리 |
| 큰 이미지 (~5MB HEIC) | 웹은 client 에서 downscale, 봇은 원본 사용 (Telegram 은 이미 압축) |
| Claude CLI `@`-reference 가 tools 설정과 충돌 | impl 시 확인, 필요 시 `--tools "read"` 로 완화 |

## 테스트 계획

- `scripts/test-vision-photo-estimate.ts` — 샘플 이미지 (public/samples/food-*.jpg) 로 케이스 테이블 (김밥, 샐러드, 스테이크 등)
- 봇 통합 테스트는 실제 텔레그램 세션에서 수동 (자동화 어려움)
- 웹 UI: `/lifestyle` 페이지에서 파일 첨부 → 응답 확인

## 산출물

- `src/lib/nutrition/estimate-nutrition-photo.ts` (신규)
- `src/bot/commands/food-photo.ts` (신규) + `src/bot/bot.ts` 등록
- `src/bot/commands/food-edit-callback.ts` (확장 · 3-button keyboard + description 정정)
- `src/app/api/food/route.ts` (multipart 분기 추가)
- `src/components/lifestyle/FoodPhotoUpload.tsx` (신규 · 📷 버튼 + 상태)
- `src/app/lifestyle/lifestyle-client.tsx` (FoodRow 에 📝 description 정정 inline edit)
- `scripts/test-vision-photo-estimate.ts` (신규)
- `docs/designs/309-photo/` (UI 시안)
