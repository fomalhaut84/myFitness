# [M14] 자체 음식 트래킹 + AI 기반 kcal 추정 (MyFitnessPal 대체)

- **작성일**: 2026-08-07
- **이슈**: (예정 — 승인 후 생성)
- **선행**: M4-2 (칼로리 밸런스 계산), M4-3 (FoodLog + `/food` 봇 명령)
- **범위**: Phase 1 — 텔레그램 자유 텍스트 입력 → AI 로 kcal 자동 추정 → 저장 → 대시보드 자동 반영

## 배경

MyFitnessPal 을 이용 중이었으나 아래 이유로 이탈:
1. **한국 음식 DB 부족** — 집밥·한식·문화권 음식 검색 결과 부정확
2. **매번 밈(meal) 재작성** — 자주 먹는 것 재사용 UX 나쁨

현재 프로젝트의 `FoodLog` + `/food` 봇 명령은 이미 자체 구현이지만 `estimatedKcal = null` 로 저장 — 실제 kcal 추정을 아무도 안 함. 따라서 `DailySummary.estimatedIntakeCalories` 도 비어 있고 대시보드 "섭취" 카드가 사실상 무의미. **MFP 대체의 실질적 완성은 kcal 자동 추정 하나로 달성됨.**

Phase 2 이후 (자주 먹는 음식 라이브러리, 매크로 P/C/F, 외부 DB) 는 별도 이슈로 분리.

## 목표 (Phase 1)

- [ ] 텔레그램 봇 `/food` 흐름에서 자유 텍스트 → Claude AI 로 kcal 추정 (한국 음식 특화 프롬프트)
- [ ] `FoodLog.estimatedKcal` 자동 저장, 실패 시 null (기존 저장 흐름 유지)
- [ ] `DailySummary.estimatedIntakeCalories` 재계산 (기존 훅 사용, 값만 채워지면 됨)
- [ ] 봇 리플라이에 추정 kcal 노출 + 사용자 정정 명령 (`/food_kcal <id> <kcal>`)
- [ ] 웹 lifestyle 페이지에 오늘 음식 로그 리스트 (kcal 편집 인라인)
- [ ] AI 리포트 시스템 프롬프트에 "kcal 은 AI 추정치, ±30% 오차 가능" 명시
- [ ] 실패/재시도 정책: 외부 API 실패 시 log 저장은 성공, kcal 만 null → cron 재시도 (weather backfill 패턴 재사용)

## 비목표 (Phase 2+ 로 분리)

- 자주 먹는 음식 라이브러리 (past FoodLog description 재사용, 유사도 매칭)
- P/C/F 매크로 분석, 단백질 목표 추적 (기존 스펙 `m4-8-nutrition-analysis.md`)
- 외부 음식 DB 연동 (오픈식약처 등)
- 사진 → Vision 분석
- 사용자별 즐겨찾기 밈

## 기술 설계

### 1) 스키마 변경 (최소)

`FoodLog` 는 이미 존재 (`description`, `estimatedKcal`, `mealType`, `date`). Phase 1 은 스키마 변경 없음. 필요 시 확장 가능:

```prisma
// (선택, Phase 1 은 미도입) — 재추정 판정 + attempt 로테이션 (weather backfill 패턴)
model FoodLog {
  // ...
  kcalSource     String?    // "ai-estimate" | "user-edit" | null
  kcalEstimatedAt DateTime?
  kcalAttempts   Int?
}
```

**결정**: Phase 1 은 스키마 미변경. `estimatedKcal` 이 null 이면 재추정 대상, non-null 이면 완료 로 간주. 사용자 수정이 AI 재추정에 덮이지 않게 하려면 → 봇 명령어에서 `estimatedKcal` 세팅 시점에 `kcalSource` 를 알아야 하지만 이건 Phase 2 로. Phase 1 은 **AI 실패 → null → cron 이 재시도** 정도만 처리.

### 2) AI kcal 추정 서비스

`src/lib/nutrition/estimate-kcal.ts` (신규):

```typescript
export interface KcalEstimateInput {
  description: string;   // 예: "김치찌개 밥 계란후라이"
  mealType?: string;     // breakfast / lunch / dinner / snack
}

export interface KcalEstimate {
  kcal: number;              // 추정 총 kcal
  confidence: "low" | "med" | "high";
  breakdown?: { name: string; kcal: number }[]; // 항목별 (로그·디버그용)
  raw?: string;              // 원본 AI 응답 (감사용)
}

export async function estimateKcalFromText(input: KcalEstimateInput): Promise<KcalEstimate | null>;
```

- Claude CLI (`claude -p`) 사용, 기존 `src/lib/ai/` 헬퍼 재활용
- **프롬프트 원칙**: 한국 음식·1인분 기본 가정. JSON 응답 강제. 모르는 항목은 `{ name, kcal: null }` 로 뱉게 함.
- 응답 timeout: 15초. 실패/timeout 시 null. 상위는 log 저장 자체는 성공 유지.
- 응답에 kcal 이 있어도 명백히 이상하면 (음수/1항목 3000kcal+) reject → null.

**프롬프트 예시**:
```
당신은 한국 식사의 kcal 을 추정합니다. 다음 사용자 입력을 항목별로 분해하고
1인분 기준 kcal 을 매기세요. JSON 만 응답:

입력: "{description}"
{mealType 이 있으면 "식사 유형: {mealType}"}

응답 형식:
{
  "items": [{"name": "김치찌개", "kcal": 350}, ...],
  "total_kcal": <합>,
  "confidence": "low" | "med" | "high",
  "notes": "1인분 기준, 밥 반공기 포함 가정"
}
```

### 3) 봇 흐름 변경

`src/bot/commands/food.ts` (기존):
1. 정규식 매칭 → mealType 추출
2. description 저장 (kcal=null)
3. 리플라이: `✅ 점심 기록 완료 / 📝 김치찌개 밥`

Phase 1 후:
1. 정규식 매칭 → mealType 추출
2. description 저장 (kcal=null, id 획득)
3. **fire-and-forget** kcal 추정 → 성공 시 update (`estimatedKcal`, `recalculateCalorieBalance`) → 봇에 후속 메시지 편집 or 재전송
4. 사용자에게 처음엔 `✅ 점심 기록 완료 (kcal 계산 중…)` → 완료 후 `📊 김치찌개 밥 → 약 620 kcal (med)`
5. 정정 명령: `/food_kcal <id> <kcal>` — id 는 이전 응답에서 노출

**대안**: `await` 로 kcal 추정 완료까지 기다린 뒤 한 번에 응답. 15초 timeout 이면 봇 응답 지연 허용 가능. 구현 단순성이 우세 → **await 로 시작, 추정 실패 시 kcal 없이 응답**.

### 4) 웹 UI (활동 lifestyle 페이지)

`src/app/lifestyle/` — 하루 음식 로그 리스트 신규 섹션:
- 오늘 (KST) 의 FoodLog 목록 표시: `아침 / 점심 / 저녁 / 간식` 그룹
- 각 항목: description, kcal (없으면 `— kcal`), 편집/삭제 버튼
- 인라인 kcal 편집: PATCH `/api/food/{id}` — 신규 route
- 합계 표시: `총 섭취 1,450 kcal (AI 추정)`

`src/app/api/food/[id]/route.ts` (신규):
- PATCH: kcal 수정 + `recalculateCalorieBalance` 재실행
- DELETE: 삭제 + 재계산

### 5) AI 리포트 반영

`src/lib/ai/system-prompt.ts` 에 다음 라인 추가:
```
- FoodLog.estimatedKcal 은 AI 자동 추정치. ±30% 오차 가능. 절대값보다 하루/주간 추세로 판단.
- 사용자가 명시적으로 kcal 을 수정한 경우 (수동 로그) 우선 신뢰.
```

## 테스트 계획

- **단위**:
  - `estimateKcalFromText` mock fetch → JSON 파싱, 이상값 reject 검증
  - 봇 `handleFoodInput` — AI 성공/실패 두 경로 응답 문구
- **통합**:
  - 실제 Claude CLI 호출 (수동, `npm run test:kcal-live` 스크립트) — 대표 5개 한식 kcal 추정 결과 spot-check
- **검증 (배포 후)**:
  - 텔레그램에서 "점심 김치찌개 밥" 입력 → 15초 내 kcal 응답
  - 대시보드 "섭취" 카드에 값 표시
  - 다음 날 아침 리포트에서 전날 섭취 언급

## 배포 노트

- DB 마이그레이션 없음 (Phase 1)
- Claude CLI 이미 설치·인증 완료 상태 가정 (기존 리포트 흐름과 동일 환경)
- 롤백: 봇 코드 revert 시 기존 흐름 (kcal null 저장) 복귀. 이미 저장된 kcal 값은 남음 (안전).

## 후속 (Phase 2 로 별도 이슈)

1. **봇 정정 UX 모바일 개선** — 사용자 피드백 (2026-08-09): `/food_kcal <cuid> <kcal>` 형식이 모바일에서 cuid 타이핑 불편. 대안 (우선순위 순):
   1. Telegram reply-to — 봇 kcal 응답 메시지에 사용자 reply → `/food_kcal 400` 만 (id 는 원본 메시지에서 추출)
   2. Inline keyboard "수정" 버튼 → callback_query 로 처리 (id 는 `callback_data` 에 embed)
   3. 최근 N 분 이내 마지막 log 를 default 로 (`/food_kcal 400` 만 입력)
   4. 웹 UI 로만 편집 유도 (lifestyle 페이지 인라인 편집이 이미 있음, 봇 명령 제거 안내)
2. **자주 먹는 음식 라이브러리** — 신규 로그 저장 전 최근 30일 유사 description 검색 (embedding or 문자열 유사도) → 있으면 그 kcal 재사용 (AI 호출 절감 + 일관성). MFP "밈 재작성" 페인 포인트 직접 해결.
3. **P/C/F 매크로** — 기존 `m4-8-nutrition-analysis.md` 스펙 부활
4. **외부 음식 DB** — 오픈식약처, 만개의 레시피 API 등
5. **사진 입력** — Claude Vision 으로 사진 → 항목 추출 → kcal
6. **재추정 backfill** — weather backfill 패턴 재활용, 옛 로그의 kcal null 대량 처리 스크립트

## 관련 메모리

- `feedback_bot_mobile_ux` — 봇 명령에서 cuid 등 긴 식별자 입력 요구 금지
- `feedback_release_via_pr` — 릴리즈는 dev→main PR + 사용자 머지
- `feedback_review_policy` — 사전 pr-review-toolkit 1회 + Codex bot 만
