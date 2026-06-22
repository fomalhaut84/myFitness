# M5-2-2: `get_training_load_trend` MCP 도구

- **작성일**: 2026-06-22
- **타입**: feature (P1)
- **마일스톤**: M5-2 (`docs/specs/m5-overview.md`)
- **백엔드 전용**

## 1. 목적

오버트레이닝/언더트레이닝 위험을 결정적으로 산출해 AI가 주간 리포트 + 모닝 리포트에서 일관된 평가 제공. 기존엔 `get_activities` 로 14일치 받아 AI가 직접 합산 → 토큰 낭비 + 산출 비결정성.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 신규 MCP 도구 `get_training_load_trend`. 입력 파라미터 없음.
- [ ] **F2**: 데이터 소스 = `Activity.intensityScore` (M4-5에서 산출된 TRIMP-유사 0~100). 일자별 합계 → 평균.
- [ ] **F3**: 산출 지표:
  - **Acute (7일)**: 최근 7일 일평균 트레이닝 로드
  - **Chronic (28일)**: 최근 28일 일평균 트레이닝 로드
  - **ACWR** (Acute:Chronic Workload Ratio) = acute / chronic
  - **14일 보조 구간**: 트렌드 비교용
- [ ] **F4**: ACWR 위험 구간 라벨 + 권고 (스포츠과학 표준, raw 값 기준 분류):
  - `< 0.8` → `detraining` — "운동량 부족, 피트니스 손실 위험"
  - `[0.8, 1.3)` → `sweet_spot` — "최적 부하 구간"
  - `[1.3, 1.5]` → `high` — "부하 증가 주의"
  - `> 1.5` → `very_high` — "부상 위험, 회복 우선"
  - chronic가 0이면 ACWR 계산 불가 → `null`, 라벨 `insufficient_data`
  - 분류는 round 적용 전 raw 값 기준 (1.496 → 1.5로 round되어도 분류는 high)
- [ ] **F5**: 응답 객체 — JSON 직렬화. 토큰 ≤ 500.

### 2.2 비기능

- KST 기준 (오늘 포함 7/14/28일)
- DB 쿼리 1건 (`findMany` startTime ≥ 28일 전, 메모리에서 일별 합계)
- 데이터 누락 graceful — null/0 명시

## 3. 기술 설계

### 3.1 윈도우 정의

```
chronic28d: startTime >= daysAgoKST(27), <= todayKST() (오늘 포함 28일)
acute7d:    startTime >= daysAgoKST(6),  <= todayKST() (오늘 포함 7일)
recent14d:  startTime >= daysAgoKST(13), <= todayKST() (오늘 포함 14일)
```

`acute`는 `chronic` 의 부분집합이므로 한 쿼리(28일치)로 끝, 메모리에서 슬라이싱.

### 3.2 일별 합계

각 Activity 의 `startTime` 을 KST 날짜로 변환 → `Map<YYYY-MM-DD, sum(intensityScore)>`.
활동 없는 날은 0 (휴식일).
restDays 카운트 = 합계 0인 날 수.

### 3.3 ACWR 산출

```ts
const acuteAvg = acuteTotal / 7;
const chronicAvg = chronicTotal / 28;
const acwr = chronicAvg > 0 ? acuteAvg / chronicAvg : null;
```

`chronicAvg === 0` → 28일 전부 휴식 → `acwr = null`, 라벨 `insufficient_data`.

### 3.4 위험 구간 분류

```ts
function classify(acwr: number | null): { zone, recommendation } | null {
  if (acwr === null) return null;
  if (acwr < 0.8) return { zone: "detraining", recommendation: "..." };
  if (acwr < 1.3) return { zone: "sweet_spot", recommendation: "..." };
  if (acwr < 1.5) return { zone: "high", recommendation: "..." };
  return { zone: "very_high", recommendation: "..." };
}
```

### 3.5 응답 스키마

```ts
{
  date: "2026-06-22",                  // 오늘 KST
  acute7d: {
    totalIntensityScore: 350,
    avgDailyScore: 50.0,
    days: 7,
    restDays: 2,
  },
  chronic28d: {
    totalIntensityScore: 1400,
    avgDailyScore: 50.0,
    days: 28,
    restDays: 8,
  },
  recent14d: {
    totalIntensityScore: 700,
    avgDailyScore: 50.0,
    days: 14,
    restDays: 4,
  },
  acwr: 1.0 | null,
  zone: "sweet_spot" | "detraining" | "high" | "very_high" | "insufficient_data",
  recommendation: "최적 부하 구간 — 현재 강도 유지" | null,
}
```

## 4. 변경 파일

- `src/mcp/tools/training-load.ts` *(신규)*
- `src/mcp/server.ts` — `get_training_load_trend` 등록
- `src/lib/ai/claude-advisor.ts` — `--allowedTools` 에 `mcp__myfitness__get_training_load_trend` 추가 (M5-2-1 누락 대응 학습)

## 5. 테스트 계획

`npm run lint && npm run typecheck && npm run build` 3종.
운영 적용 후 PM2 로그에서 도구 호출 확인.

## 6. 제외 사항

- 시각화 (UI) — 별도
- HR 기반 trimp 재계산 (Activity.trimp 필드 추가) — M4-5 intensityScore 그대로 사용
- 위험 알림 — 추후

## 7. 롤백

`git revert`. DB 영향 없음.
