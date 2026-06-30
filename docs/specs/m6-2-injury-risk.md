# M6-2: `get_injury_risk_score` MCP 도구

- **작성일**: 2026-06-30
- **타입**: feature (P1)
- **마일스톤**: M6 (`docs/specs/m6-overview.md`)
- **백엔드 전용**

## 1. 목적

부상 / 오버트레이닝 위험을 결정적으로 산출. AI 가 모닝/이브닝 리포트에서 매번 prompt 로 "최근 HRV 하락 추세이고 ACWR 도 높으니..." 같은 일반론을 만드는 대신 **고정된 가중치 + 기여 요인 top 3 + 권장 조치** 를 단일 호출로 받아 일관된 평가 제공.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 신규 MCP 도구 `get_injury_risk_score`. 입력 파라미터 없음.
- [ ] **F2**: 데이터 소스 (모두 KST 기준):
  - SleepRecord 14일 (HRV / restingHR / sleepScore)
  - SleepRecord/DailySummary 28일 (restingHR 장기 평균)
  - Activity 28일 (ACWR 산출용 intensityScore, M5-2-2 활용)
- [ ] **F3**: 4개 위험 요인 (각 0-100 normalized):
  - **HRV 하락**: 최근 7일 평균 vs 이전 7일 (8-14일 전) 평균. 하락폭 % 기반.
  - **ACWR 위험**: M5-2-2 와 동일 계산 (acute 7d / chronic 28d). high/very_high zone 시 점수 ↑.
  - **수면 불안정**: 최근 14일 sleepScore 표준편차 / 평균.
  - **RestingHR 상승**: 최근 7일 평균 vs 28일 평균 (오늘 제외). 상승폭 bpm 기반.
- [ ] **F4**: 가중 평균 (각 25%) → 0-100 final risk score.
- [ ] **F5**: 4단계 라벨:
  - `0-25` → `safe` — "현재 패턴 유지"
  - `25-50` → `caution` — "회복일 1회 추가 권장"
  - `50-75` → `elevated` — "이번 주 강도 -20%, 회복 우선"
  - `75-100` → `high` — "2-3일 완전 휴식 권장"
- [ ] **F6**: 기여 요인 top 3 — 4개 중 점수 높은 3개. 각 `{ factor, score, detail }`.
- [ ] **F7**: 응답 JSON ≤ 600 토큰.

### 2.2 비기능

- 데이터 누락 graceful — 각 요인 산출 불가 시 `null` + 라벨에서 제외 (가중치 재정규화).
- DB 쿼리 ≤ 4 (Promise.all 병렬).
- KST 기준 (오늘 = 평가 기준일).

## 3. 기술 설계

### 3.1 데이터 조회

```ts
const todayKst = todayKST();
const sevenDaysAgo = daysAgoKST(7);
const fourteenDaysAgo = daysAgoKST(14);
const twentyEightDaysAgo = daysAgoKST(28);

const [sleeps14d, dailies28d, activities28d] = await Promise.all([
  prisma.sleepRecord.findMany({
    where: { date: { gte: fourteenDaysAgo, lt: todayKst } },
    select: { date, hrvOvernight, restingHR, sleepScore },
  }),
  prisma.dailySummary.findMany({
    where: { date: { gte: twentyEightDaysAgo, lt: todayKst } },
    select: { date, restingHR },
  }),
  prisma.activity.findMany({
    where: { startTime: { gte: twentyEightDaysAgo, lt: tomorrow } },
    select: { startTime, intensityScore },
  }),
]);
```

### 3.2 4개 요인 산출

#### HRV 하락 (0-100, 높을수록 위험)

```ts
const hrvRecent7 = average(sleeps.last7.map(s => s.hrvOvernight));
const hrvPrev7 = average(sleeps.days8to14.map(s => s.hrvOvernight));
if (hrvRecent7 == null || hrvPrev7 == null) return null;
const dropPct = (hrvPrev7 - hrvRecent7) / hrvPrev7 * 100;
// 하락 0% = 0점, 10% 하락 = 50점, 20%+ 하락 = 100점
const score = clamp(dropPct * 5, 0, 100);
```

#### ACWR 위험 (0-100)

M5-2-2 와 동일 계산:
```ts
const acwr = (acute7Total / 7) / (chronic28Total / 28);
// < 0.8: detraining (위험 낮음, 50점)
// 0.8 ~ 1.3: sweet spot (0-20점)
// 1.3 ~ 1.5: high (50-75점)
// > 1.5: very_high (80-100점)
```

#### 수면 불안정 (0-100)

```ts
const sleepScores = sleeps14d.map(s => s.sleepScore).filter(notNull);
if (sleepScores.length < 7) return null;
const mean = average(sleepScores);
const variance = sleepScores.reduce((a, b) => a + (b - mean) ** 2, 0) / sleepScores.length;
const stdDev = Math.sqrt(variance);
const cv = (stdDev / mean) * 100; // coefficient of variation
// CV 0-5: 안정 (0점), 5-10: 보통 (50점), 10+: 불안정 (100점)
const score = clamp((cv - 5) * 10, 0, 100);
```

#### RestingHR 상승 (0-100)

```ts
const rhrRecent7 = average(sleeps.last7.map(s => s.restingHR ?? null));
const rhr28Baseline = average(daily28d.map(d => d.restingHR ?? null));
if (rhrRecent7 == null || rhr28Baseline == null) return null;
const deltaBpm = rhrRecent7 - rhr28Baseline;
// 0 bpm = 0점, +3 bpm = 50점, +6 bpm 이상 = 100점
const score = clamp(deltaBpm * 16.7, 0, 100);
```

### 3.3 통합 점수

```ts
const factors = [
  { name: "hrv_decline", score: hrvScore, weight: 25, detail: "..." },
  { name: "acwr_load", score: acwrScore, weight: 25, detail: "..." },
  { name: "sleep_instability", score: sleepInstScore, weight: 25, detail: "..." },
  { name: "resting_hr_rise", score: rhrScore, weight: 25, detail: "..." },
];

const valid = factors.filter(f => f.score !== null);
const totalWeight = valid.reduce((a, b) => a + b.weight, 0);
const riskScore = totalWeight > 0
  ? Math.round(valid.reduce((a, b) => a + b.score! * b.weight, 0) / totalWeight)
  : null;
```

### 3.4 분류 + 권장 조치

```ts
function classify(score: number): { label, recommendation } {
  if (score < 25) return { label: "safe", recommendation: "현재 패턴 유지" };
  if (score < 50) return { label: "caution", recommendation: "회복일 1회 추가 권장" };
  if (score < 75) return { label: "elevated", recommendation: "이번 주 강도 -20%, 회복 우선" };
  return { label: "high", recommendation: "2-3일 완전 휴식 권장" };
}
```

### 3.5 응답 스키마

```jsonc
{
  "date": "2026-06-30",
  "riskScore": 42,                 // null 가능 (데이터 부족)
  "label": "caution",              // null 가능
  "recommendation": "회복일 1회 추가 권장" | null,
  "topFactors": [                  // 점수 높은 3개 (모든 요인 null이면 빈 배열)
    {
      "factor": "acwr_load",
      "score": 65,
      "detail": "ACWR 1.42 (high zone), acute 7d avg 18.5 vs chronic 28d avg 13.0"
    },
    {
      "factor": "hrv_decline",
      "score": 45,
      "detail": "최근 7일 HRV 평균 42.1 ms vs 이전 7일 평균 46.0 ms (-8.5%)"
    },
    {
      "factor": "resting_hr_rise",
      "score": 17,
      "detail": "최근 7일 RHR 평균 54 bpm vs 28일 baseline 53 bpm (+1 bpm)"
    }
  ],
  "allFactors": {                  // 4개 모두 (null 포함, AI 가 전체 컨텍스트로 활용)
    "hrv_decline": { "score": 45, "detail": "..." },
    "acwr_load": { "score": 65, "detail": "..." },
    "sleep_instability": { "score": 18, "detail": "..." },
    "resting_hr_rise": { "score": 17, "detail": "..." }
  }
}
```

## 4. 변경 파일

- `src/mcp/tools/injury-risk.ts` *(신규)*
- `src/mcp/server.ts` — `get_injury_risk_score` 등록
- `src/lib/ai/claude-advisor.ts` — `--allowedTools` 에 `mcp__myfitness__get_injury_risk_score` 추가

## 5. 테스트 계획

- `npm run lint && npm run typecheck && npm run build` 3종.
- 운영 적용 후 다음 모닝 리포트에서 도구 호출 확인 (`pm2 logs`).

## 6. 제외 사항

- 시각화 / UI — 별도 마일스톤
- 부상 이력 추적 (사용자 직접 입력) — 별도 backlog
- 머신러닝 기반 risk score — 단순 가중합으로 충분 (1인 시스템, 데이터 양 제한)
- 알림 발송 (high zone 시 텔레그램 자동) — 별도 backlog

## 7. 롤백

`git revert`. DB / 환경변수 영향 없음.
