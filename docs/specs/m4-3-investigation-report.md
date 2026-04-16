# [M4-3] 식단 데이터 연동 조사 결과 보고

**조사일:** 2026-04-16
**조사 대상:** Garmin Connect API → MFP 식단 데이터 접근 가능 여부

## 결론

**❌ Garmin Connect 경유로 MFP 식단 데이터 접근 불가 (현재 상태).**

단, 인프라는 존재하므로 MFP ↔ Garmin 연동 활성화 후 재조사 가치 있음.

## 조사 상세

### 1. @flow-js/garmin-connect 라이브러리
- 식단/영양 관련 메서드 **없음** (nutrition, food, diet, meal 키워드 전무)
- hydration 타입은 있으나 nutrition/food 타입 없음

### 2. DailySummary API (usersummary-service)

Garmin의 일일 요약 응답에 다음 필드 확인:

```json
{
  "consumedKilocalories": null,
  "includesCalorieConsumedData": false,
  "netCalorieGoal": 1890,
  "remainingKilocalories": 2083,
  "netRemainingKilocalories": 2083
}
```

**핵심:**
- `consumedKilocalories` — 섭취 칼로리 필드가 존재하지만 **null** (데이터 미유입)
- `includesCalorieConsumedData: false` — MFP 연동이 꺼져있거나, MFP에서 데이터를 보내지 않고 있음
- `netCalorieGoal: 1890` — Garmin이 사용자의 칼로리 목표를 이미 보유! (bonus)

### 3. 영양 전용 엔드포인트

| 엔드포인트 | 결과 |
|---|---|
| `connectapi/nutrition-service/nutrition/day/{date}` | 404 |
| `connectapi/nutrition-service/nutrition/{date}` | 404 |
| `connectapi/nutrition-service/nutrition/daily/{date}` | 404 |
| `connectapi/wellness-service/wellness/dailyNutrition/{date}` | 404 |
| `connectapi/wellness-service/wellness/nutrition/{date}` | 404 |
| `connectapi/usersummary-service/usersummary/dailyCalories` | 404 |
| `connectapi/food-service/food/day/{date}` | 404 |
| `connectapi/food-service/food/daily/{date}` | 404 |
| `connect.garmin.com/nutrition-service/*` | 로그인 페이지 리다이렉트 |
| `connect.garmin.com/modern/proxy/*` | 로그인 페이지 리다이렉트 |

**결론:** nutrition-service, food-service는 connectapi 도메인에서 서비스되지 않거나, OAuth 토큰으로 접근 불가.

### 4. 사용자 프로필
- 서드파티 앱/MFP 연동 관련 필드 없음

## 보너스 발견: netCalorieGoal

`usersummary-service`의 `netCalorieGoal: 1890` 값으로 UserProfile.targetCalories를 **Garmin에서 자동 싱크** 가능.

→ 프로필 설정에서 수동 입력 대신, 싱크 시 Garmin 칼로리 목표를 가져오는 기능 추가 권장.

## 후속 조치

### 즉시 실행 가능
1. **`netCalorieGoal` 자동 싱크** — DailySummary 싱크 시 UserProfile.targetCalories에 반영

### 사용자 확인 필요
2. **MFP ↔ Garmin 연동 활성화** — Garmin Connect 앱 → 설정 → 연결된 앱 → MyFitnessPal 활성화 후 재조사
   - 연동 후 `consumedKilocalories`에 값이 채워지면 별도 fetcher 없이 DailySummary 싱크로 해결 가능

### 백로그 이관
3. **비공식 MFP API** — python-myfitnesspal 라이브러리 포팅 또는 HTTP scraping
4. **수동 입력 UI 고도화** — 현재 기본 칼로리 추정 → AI 기반 정확도 개선
