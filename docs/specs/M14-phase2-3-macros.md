# [M14 Phase 2 #3] P/C/F 매크로 추적

- **작성일**: 2026-08-11
- **선행**: M4-2 (칼로리 밸런스), M4-3 (FoodLog), M14 Phase 1 (#283 · v2.19.0), M14 Phase 2 #2 (#295 · v2.21.0)
- **부활 스펙**: `docs/specs/m4-8-nutrition-analysis.md` 를 M14 컨텍스트로 재구성
- **상태**: 계획

## 배경

M14 Phase 1 은 kcal 을 채웠지만 매크로 (단백질/탄수화물/지방) 는 여전히 미측정. 러너 특화 앱으로서 근손실 방지 판단이 어렵다:

- **단백질 부족 감지 불가** — 체중 대비 g/kg 표시가 없어 러너 권장 (1.6g/kg) 대비 얼마나 부족한지 알 수 없음.
- **매크로 밸런스 무근거** — 다이어트/성능 진단이 kcal 결손만으로는 부족. 근손실은 kcal 결손 × 단백질 부족 × 고강도 볼륨의 조합.
- **AI 리포트 근거 부족** — 근손실 위험 언급을 프롬프트에서 못 하니 어드바이저가 저강도 부활만 반복 권고.

Phase 2 #2 (repeat lookup) 인프라를 재활용하면 P/C/F 를 동일 흐름에 태워 추가 비용 없이 배포 가능.

## 목표 (Phase 2 #3)

- [ ] `FoodLog` 에 `proteinG · carbsG · fatG Float?` 필드 추가 (nullable — 미측정 허용)
- [ ] `UserProfile.proteinTargetPerKg Float?` (default 1.6) — 러너 권장치 기본, 편집 UI 는 후속
- [ ] AI 추정 확장 — `estimateNutritionFromText` : kcal + P/C/F 4값 반환. 기존 `estimateKcalFromText` deprecate.
- [ ] Repeat lookup (`findRecentSameDescription`) 이 P/C/F 도 재사용
- [ ] 일별 매크로 합계 (`aggregateDailyMacros(date)`) → `DailySummary` 확장 or `DailyNutrition` 파생 필드
- [ ] 근손실 위험 평가 (`assessMuscleLossRisk`) — kcal 결손 + P/kg + 고강도 볼륨 3인 스코어
- [ ] AI 리포트 프롬프트에 위험 평가 결과 주입 → 경고/권장사항 반영
- [ ] `/nutrition` 페이지 — 매크로 도넛 (P/C/F 비율) + 단백질 g/kg 트렌드 (7일) + 위험 배너
- [ ] Backfill: 기존 FoodLog P/C/F null 재추정 — weather backfill 패턴 재활용, random-sample rotation

## 비목표 (후속)

- 매크로 목표치 세부 편집 UI (기본 1.6g/kg 만; 편집 필요 시 이슈 분리)
- 미량영양소 (비타민/미네랄) — Vision + 외부 DB 없이는 신뢰도 부족
- 사용자 정의 매크로 비율 (P/C/F % 목표)
- 매크로 기반 자동 식단 추천

## 기술 설계

### 1) 스키마 변경

```prisma
model FoodLog {
  id            String   @id @default(cuid())
  date          DateTime
  description   String
  estimatedKcal Int?
  proteinG      Float?   // 단백질 g
  carbsG        Float?   // 탄수화물 g
  fatG          Float?   // 지방 g
  mealType      String?
  createdAt     DateTime @default(now())

  @@index([date])
}

model UserProfile {
  // ...
  proteinTargetPerKg Float?  @default(1.6)  // g/kg 체중 (러너 권장)
}
```

Migration: `add_food_log_macros`. 수동 SQL 로 (per `feedback: 절대 prisma migrate reset 금지`).

### 2) AI 추정 확장 — `src/lib/nutrition/estimate-nutrition.ts`

기존 `estimate-kcal.ts` 를 확장 (기존 파일 유지 · deprecate 마킹 · 신 함수는 별도 파일).

응답 스키마:
```json
{
  "items": [
    {"name": "김치찌개", "kcal": 350, "protein_g": 22, "carbs_g": 18, "fat_g": 20}
  ],
  "total_kcal": 350,
  "total_protein_g": 22,
  "total_carbs_g": 18,
  "total_fat_g": 20,
  "confidence": "med",
  "notes": "가정: 돼지고기 100g 포함"
}
```

검증 계층:
- 기존 kcal 검증 (음수/상한/item-per-cap) 재사용.
- 추가: `P·4 + C·4 + F·9` ≈ `total_kcal` (±20% 허용 — AI 반올림 감안).
- 부분 null 허용 (일부 item 만 P/C/F 반환 시 total 도 부분합).

### 3) Repeat lookup 확장

`RepeatLookupHit` 인터페이스에 `proteinG / carbsG / fatG` 추가. 매치 시 P/C/F 도 함께 복사.

```typescript
export interface RepeatLookupHit {
  logId: string;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  date: Date;
  mealType: string | null;
  description: string;
}
```

Pool `select` 에 P/C/F 필드 추가. 정규화 로직 (`normalizeDescription`) 그대로 재사용.

### 4) 일별 집계

옵션 A: `DailySummary` 에 `intakeProteinG / intakeCarbsG / intakeFatG Float?` 추가 · `recalculateCalorieBalance` 확장.
옵션 B: 파생 함수 `aggregateDailyMacros(date)` 만 노출 · DB 필드 없이 UI 요청 시 계산.

**선호**: 옵션 A. AI 리포트 프롬프트 주입 시 반복 계산 회피 + 대시보드 응답 속도 유지.

집계 규칙: `sum(P) / sum(C) / sum(F)` — null 은 0 이 아니라 skip (kcal 방식과 동일). 하나라도 null 있으면 total 도 null propagate (사용자에게 "부분 미측정" 표시).

### 5) 근손실 위험 평가 — `src/lib/fitness/muscle-loss-risk.ts`

```typescript
export interface MuscleLossInput {
  weeklyCalorieDeficit: number;   // 최근 7일 avg kcal/day, 결손 = out - in
  avgProteinPerKg: number;        // 최근 7일 avg g/kg
  weeklyHighIntensityMin: number; // 최근 7일 Z4+ 분
  bodyWeightKg: number;           // 최근 체중
  proteinTargetPerKg: number;     // UserProfile 기본 1.6
}

export interface MuscleLossVerdict {
  risk: "low" | "medium" | "high";
  score: number;
  reasons: string[];
  recommendations: string[];
}
```

스코어 (합산):
- kcal 결손 > 500/day (+1)
- protein < target × 0.9 (+1) — 10% margin
- 고강도 Z4+ > 30분/주 (+1)

Risk: `>=3 high`, `>=2 medium`, else `low`.

Recommendations 예:
- P 부족: "단백질 하루 XXg 추가 (~계란 3개 또는 닭가슴살 100g)"
- 결손 과다: "결손을 300~500kcal 로 완화 권장"
- 고볼륨: "회복일 1~2회 확보"

### 6) AI 리포트 연동

`src/lib/ai/context-builder.ts` (또는 유사) 에 매크로 섹션 주입:

```
[매크로 (최근 7일 평균)]
- 단백질: XXg (X.Xg/kg, 목표 1.6g/kg)
- 탄수화물: XXg
- 지방: XXg

[근손실 위험: HIGH]
- 일평균 결손 750kcal (>500)
- 단백질 1.2g/kg (<1.6 권장)
- 고강도 주 45분 (>30)
→ 권장: 단백질 하루 40g 추가, 결손 400kcal 로 완화, 회복일 확보
```

### 7) `/nutrition` 페이지

레이아웃 (모바일 우선):
1. **매크로 도넛** — P/C/F kcal 기준 비율 (P·4 + C·4 + F·9 / total). 최근 7일 평균.
2. **단백질 g/kg 트렌드** — 7일 라인 차트 + 목표선 (1.6g/kg). 오늘 수치 강조.
3. **근손실 위험 배너** — 위험 시 상단 붉은 배너. 이유·권장사항 표시.
4. **오늘 항목 리스트** — 기존 `/lifestyle` 의 FoodLog 리스트 재사용 + P/C/F 열 추가.

컴포넌트:
- `src/components/nutrition/MacroDonut.tsx`
- `src/components/nutrition/ProteinTrend.tsx`
- `src/components/nutrition/MuscleLossBanner.tsx`
- `src/app/nutrition/page.tsx`

라우팅: 기존 `/lifestyle` 아래 탭 또는 별도 `/nutrition`. **선호**: 별도 페이지 — lifestyle 은 이미 tall, 매크로는 독립 관심사.

### 8) Backfill

`src/lib/nutrition/backfill.ts` 를 확장 — 기존 kcal 만 채우던 로직을 `estimateNutritionFromText` 로 교체. **하위 호환**: kcal 만 있는 로그도 P/C/F 재추정 대상 (P/C/F 가 하나라도 null 이면 실행).

Random-sample rotation 은 그대로. Rate limit 방어를 위해 batch 크기 유지 (기본 5개/tick).

수동 실행: `npm run backfill:food-macros` (기존 `backfill:food-kcal` 은 alias 로 유지).

## 테스트 계획

- [ ] 위험 평가 로직 단위 테스트 (3가지 조건 × low/med/high 조합 8케이스)
- [ ] AI 응답 검증 계층 단위 (kcal ≈ P·4+C·4+F·9 오차 허용)
- [ ] Repeat lookup 이 P/C/F 도 복사하는지 (기존 정규화 회귀 없음)
- [ ] Backfill: kcal 만 있는 로그 → P/C/F null 채움
- [ ] AI 리포트에 매크로 섹션 · 위험 평가 반영 (integration)
- [ ] 3-check (`npm run lint && npm run typecheck && npm run build`)

## 회귀 방지

Codex 리뷰 P1/P2 반영 시 각 이슈에 대응하는 테스트/재현 시나리오를 `scripts/` 에 추가하거나 스펙에 기록.

## 관련 메모리

- `feedback_bot_mobile_ux` — 봇 명령 UX (매크로 표시는 기존 kcal 응답에 P·C·F g 병기)
- `feedback_release_via_pr` — dev→main PR + 사용자 머지
- `feedback_review_policy` — 사전 pr-review-toolkit 1회 + Codex bot 만
- `project_mcp_180_deferred` — MCP daemon 미착수 (스코프 외)
