# M14 Phase 2 #4 — 외부 음식 DB (오픈식약처)

- **이슈**: [#315](https://github.com/fomalhaut84/myFitness/issues/315)
- **의존**: #299 (macros 저장 스키마) 완료, #309 (Vision estimator) 완료
- **관련 스펙**: [`M14-food-tracking-ai-kcal.md`](./M14-food-tracking-ai-kcal.md), [`M14-phase2-3-macros.md`](./M14-phase2-3-macros.md)

## 목적

Claude AI 추정만으로는 kcal/macros 오차가 큼 (신뢰도 low ±30%). 오픈식약처(식품안전나라) 공공데이터 API 로 표준화된 100g 당 영양성분 데이터를 활용해 **정확도 상향** + AI 호출 절감.

## 요구사항

- [ ] 오픈식약처 API 클라이언트 (`src/lib/nutrition/food-db-mfds.ts`)
  - 서비스: 식품의약품안전처 식품영양성분DB (공공데이터포털)
  - Endpoint: `https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02`
  - 인증: `serviceKey` query param (data.go.kr 통합 인증키, 활용신청 승인 필요)
  - Format: `type=json`
  - 검색: `FOOD_NM_KR` (또는 유사 파라미터 · impl 시 스펙 확인)
  - 응답 필드 (data.go.kr 스펙 · impl 시 필드명 확인): 식품명, 에너지 kcal, 탄수화물 g, 단백질 g, 지방 g, 1회제공량 g
  - `MFDS_API_KEY` 환경변수 (사용자 세팅)
  - Timeout 10s, 실패 시 null 반환 (caller AI 폴백)
- [ ] AI 검색어 추출 (`src/lib/nutrition/extract-food-query.ts`)
  - description ("아침 김치찌개 밥 300g") → items `[{name: "김치찌개", quantityG: 350}, {name: "쌀밥", quantityG: 300}]`
  - Claude CLI `-p ...` (기존 estimator 와 같은 패턴), `--tools ""`, max-turns 1, timeout 15s
- [ ] MFDS estimator (`src/lib/nutrition/estimate-nutrition-mfds.ts`)
  - AI 검색어 추출 → 각 item 별 MFDS 조회 → 100g 당 값을 quantityG 로 scale
  - 결과: `NutritionEstimate` shape 반환 (텍스트 estimator 와 동일 · confidence: "high" or "med", 소스 = "mfds")
  - 일부 item MFDS hit / 일부 miss → 히트만 사용하고 miss 는 null propagate. total macros allNonNull 판정 유지.
- [ ] 통합 (모든 로그 등록 경로)
  - POST `/api/food` (JSON) · 봇 `handleFoodInput` · backfill: repeat-lookup hit 없으면 → MFDS estimator → miss/전체 실패면 → AI estimator (기존)
  - Vision 경로 (POST multipart · 봇 photo) 는 이번 스코프 밖 (Vision 응답 자체가 items+kcal 이므로 MFDS 재검색 불필요)
- [ ] 캐시 (rate limit 방어)
  - In-memory `Map<normalizedName, MfdsHit>` — process lifecycle 유지, TTL 24h
  - 캐시 miss 시 API 호출, hit 시 재사용
  - single-user app 이라 in-memory OK

## 기술 설계

### 공공데이터포털 API 예시

```
GET https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrItdntList1
    ?serviceKey={KEY}
    &FOOD_NM_KR=김치찌개
    &pageNo=1&numOfRows=5&type=json
```

data.go.kr 표준 응답 포맷 (실제 필드명은 impl 시 API 문서 확인):
```json
{
  "header": { "resultCode": "00", "resultMsg": "NORMAL SERVICE." },
  "body": {
    "totalCount": 12,
    "pageNo": 1,
    "numOfRows": 5,
    "items": [
      { "foodNm": "김치찌개", "enerc": 44.6, "chocdf": 3.5, "prot": 3.5, "fatce": 2.0, "srvSize": "0" },
      ...
    ]
  }
}
```

**impl 노트**: data.go.kr 는 서비스마다 sub-path (`getFoodNtrItdntList1` 등) · 필드명이 조금씩 다름. 첫 커밋에서 실제 응답 로그 확인 후 필드 매핑 확정. 실패해도 caller (AI) 폴백이라 서비스 중단 없음.

### 검색어 추출 프롬프트

```
사용자 입력을 음식 항목별로 분해하고 각 항목의 검색어와 예상 섭취량(g)을 뽑아라.
- 검색어는 오픈식약처 식품영양성분DB 에서 매칭 가능한 표준 명칭 (예: "김치찌개", "쌀밥", "구운 삼겹살")
- 양이 명시 안 되면 한식 표준 1인분 기준 g (예: 밥 1공기 = 210g, 국 1대접 = 300g, 고기 1인분 = 150g)
- 응답은 JSON 만: { "items": [{"query": "...", "quantityG": <number>}] }
```

### 통합 flow (POST /api/food · 봇)

```
1. repeat-lookup 30일 window → complete-tuple hit? → 사용 · 종료
2. MFDS estimator 시도:
   a. extractFoodQuery(description) → items
   b. 각 item MFDS 조회 (in-memory cache 우선)
   c. 최소 1개 item hit + complete macros → NutritionEstimate 반환 (confidence high)
   d. 전체 miss → null
3. MFDS null → AI text estimator (기존 estimateNutritionFromText)
4. 전체 실패 → kcal null 저장 (backfill 재시도)
```

repeat-lookup 이 partial hit (kcal 만) 인 경우: MFDS 로 macros 채움 시도, 실패시 AI 로.

### 캐시 정책

```ts
const cache = new Map<string, { hit: MfdsHit | null; expiresAt: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;
// normalizedName → { hit, expiresAt }
// hit === null 도 캐시 (negative cache) 로 반복 miss 회피
```

### 환경변수

- `MFDS_API_KEY` — data.go.kr 발급 (사용자 액션 필요, README 안내)

## 비목표 (Phase 3 이후)

- 사용자 즐겨찾기 항목 관리 UI
- MFDS 응답을 DB 로 영구 캐시 (in-memory + 24h TTL 로 충분)
- 만개의 레시피 API 통합 (레시피 기반, kcal 정보 불완전 - 별도 이슈)
- Nutritionix (외식 브랜드) 보완 - Phase 3

## 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| API 키 발급 필요 (사용자 액션) | `.env.example` 에 안내, 없으면 estimator 가 null 반환 (AI 폴백) |
| Rate limit (일 1000회 default) | in-memory cache 24h TTL, single-user 앱이라 실사용 부하 낮음 |
| 매칭 정확도 (AI 검색어 → MFDS 실제 항목) | Vision estimator 와 동일한 검증 (4·4·9), miss 시 AI 폴백 |
| 100g → quantityG scale 오차 | AI 가 한식 표준 1인분 g 을 함께 추정, 사용자 [수정] 로 정정 가능 |
| API 다운 / 타임아웃 | try/catch + timeout 10s, 실패 시 caller (AI) 폴백 |

## 테스트 계획

- `scripts/test-mfds-client.ts` — 샘플 검색어 → MFDS 실제 API 호출 → 결과 출력 (수동)
- `scripts/test-extract-food-query.ts` — Claude 검색어 추출 → items 확인 (수동)
- `scripts/test-estimate-nutrition-mfds.ts` — full pipeline (extract + fetch + scale) → NutritionEstimate 검증 (수동)
- 통합 테스트: 봇에서 "점심 김치찌개 밥" 전송 → MFDS hit 여부 로그 확인

## 산출물

- `src/lib/nutrition/food-db-mfds.ts` (신규) — MFDS API 클라이언트
- `src/lib/nutrition/extract-food-query.ts` (신규) — AI 검색어 추출
- `src/lib/nutrition/estimate-nutrition-mfds.ts` (신규) — MFDS 기반 estimator
- `src/app/api/food/route.ts` (수정) — MFDS 우선 시도 후 AI 폴백
- `src/bot/commands/food.ts` (수정) — 동일
- `src/lib/nutrition/backfill.ts` (수정) — 동일
- `scripts/test-mfds-client.ts` (신규) — 수동 테스트
- `scripts/test-estimate-nutrition-mfds.ts` (신규) — pipeline 통합 테스트
- `.env.example` (수정) — `MFDS_API_KEY` 안내
