# [M3-3] 식단 데이터 연동 (Garmin 경유 조사)

## 목적

일일 섭취 칼로리 + 단백질/탄수화물/지방 자동 동기화로 칼로리 밸런스 완전 분석.

## 조사 우선

MyFitnessPal ↔ Garmin Connect 연동 시, Garmin 측에 식단/영양 데이터가 내려오는지 먼저 확인.

## 요구사항

### Phase A: 조사 (1차 목표)

- [ ] Garmin Connect에서 MFP 연동 활성화 확인
- [ ] `@flow-js/garmin-connect` 라이브러리에 식단 관련 메서드 존재 여부 확인
- [ ] 존재하지 않으면, Garmin Connect 내부 엔드포인트 탐색
  - `/wellness-service/wellness/dailyNutrition/{date}` 후보
  - `/nutrition-service/nutrition/{date}` 후보
  - `/usersummary-service/stats/daily/{date}` 응답에 calories consumed 필드 확인
- [ ] 테스트 스크립트: `scripts/investigate-garmin-nutrition.ts`
  - 최근 7일 데이터 조회
  - 응답 전체 구조를 JSON으로 덤프
  - 영양/식단 관련 필드 추출 보고

### Phase B: 데이터 존재 시 구현

- [ ] `src/lib/garmin/fetchers/nutrition.ts` 신규 fetcher
- [ ] FoodLog (기존 스키마) 활용 또는 DailyNutrition 모델 신설
  - `date`, `calories`, `protein`, `carbs`, `fat`, `fiber`, `rawData`
- [ ] `sync.ts`의 SYNC_ORDER에 `nutrition` 추가
- [ ] DailySummary.estimatedIntakeCalories 자동 업데이트 트리거

### Phase C: 데이터 없을 시

- [ ] 결과 보고 후 백로그 이슈로 이관
- [ ] 대안: 비공식 MFP API (python-myfitnesspal 포팅) 또는 수동 입력 UI

## 기술 설계

### 조사 스크립트 스켈레톤

```typescript
// scripts/investigate-garmin-nutrition.ts
import { getGarminClient } from "@/lib/garmin/client";
import { daysAgoKST } from "@/lib/garmin/utils";

async function main() {
  const client = await getGarminClient();
  const results: Record<string, unknown> = {};

  for (let i = 1; i <= 7; i++) {
    const date = daysAgoKST(i);
    const dateStr = date.toISOString().split("T")[0];

    try {
      // 후보 엔드포인트들
      const daily = await (client as any).get(
        `/wellness-service/wellness/dailyNutrition/${dateStr}`
      );
      results[dateStr] = daily;
    } catch (e) {
      results[dateStr] = { error: String(e) };
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
```

### DailyNutrition 스키마 (데이터 존재 시)

```prisma
model DailyNutrition {
  id        String   @id @default(cuid())
  date      DateTime @unique
  calories  Int?
  protein   Float?   // g
  carbs     Float?   // g
  fat       Float?   // g
  fiber     Float?   // g
  sugar     Float?   // g
  sodium    Float?   // mg
  rawData   Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 테스트 계획

- [ ] 조사 스크립트 실행 → Garmin 응답 구조 보고서
- [ ] 식단 데이터 확인 시: fetcher 정확도 (MFP 입력값과 비교)
- [ ] DailySummary.estimatedIntakeCalories 자동 연동 확인
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과

## 제외 사항

- MFP 공식 API 직접 연동 (유료, 승인 필요)
- OCR 기반 식단 인식
