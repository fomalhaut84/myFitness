# M6-3: `get_race_prediction` MCP 도구

- **작성일**: 2026-07-01
- **타입**: feature (P1)
- **마일스톤**: M6 (`docs/specs/m6-overview.md`)
- **백엔드 전용**

## 1. 목적

사용자 최근 러닝 데이터로 5K/10K/HM/FM race 예상 기록을 결정적으로 산출. AI 가 "10K 페이스로 풀 마라톤 도전 가능?" 같은 질문에 일관된 근거로 답변.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 신규 MCP 도구 `get_race_prediction`. 입력 `windowDays` (default 90, 30~365).
- [ ] **F2**: 데이터 소스 = M5-2-3 `get_pace_progression` 과 동일 필터 (러닝 계열 `contains: "running"` + distance/avgPace not null).
- [ ] **F3**: 각 target 거리 (5K/10K/HM/FM) 에 대해:
  - **best 시나리오**: source bucket 의 best 페이스로 Riegel 예측
  - **realistic 시나리오**: source bucket 의 latest 페이스로 예측
  - **conservative 시나리오**: source bucket 의 baseline 페이스로 예측
  - **confidence**: source bucket 활동 수 기반 (`high` ≥ 5, `medium` 2-4, `low` 1, `null` 0)
- [ ] **F4**: source bucket 선택 우선순위:
  1. **자체 bucket** (target 과 같은 거리, 예: 10K → 10K) — 신뢰도 최고
  2. 자체 bucket 활동 0 이면 다른 bucket 중 count 최대 사용 (Riegel 로 환산)
  3. 어느 bucket 도 활동 0 이면 예측 불가 (`null`)
- [ ] **F5**: Riegel 공식: `T2 = T1 × (D2 / D1)^1.06` (fatigue factor 1.06 표준). 같은 거리면 그대로.
- [ ] **F6**: 응답 스키마:
  - `predictions.5k/10k/HM/FM`: 각 3 시나리오 (best/realistic/conservative) + confidence + basedOn (source 설명)
  - `sourceData`: 각 bucket 활동 수 + 페이스 (M5-2-3 요약본)

### 2.2 비기능

- KST 기준 (windowDays 이전 ~ 오늘 포함).
- DB 쿼리 1건 (M5-2-3 과 동일).
- 응답 토큰 ≤ 600.

## 3. 기술 설계

### 3.1 표준 거리

```ts
const RACE_DISTANCES = {
  "5k":  { name: "5K",  meters: 5000 },
  "10k": { name: "10K", meters: 10000 },
  "HM":  { name: "HM",  meters: 21097.5 },
  "FM":  { name: "FM",  meters: 42195 },
};
```

### 3.2 Bucket 분류 (M5-2-3 재사용)

```ts
function bucketOf(distanceM: number): Bucket | null {
  const km = distanceM / 1000;
  if (km >= 4.5 && km < 5.5) return "5k";
  if (km >= 9.0 && km < 11.0) return "10k";
  if (km >= 20.0 && km < 22.0) return "HM";
  if (km >= 40.0 && km < 44.0) return "FM";
  return null;
}
```

### 3.3 Bucket summary (M5-2-3 축약)

```ts
interface BucketSummary {
  count: number;
  bestPaceSecPerKm: number;    // 활동 중 avgPace 최소
  latestPaceSecPerKm: number;  // 시간순 마지막
  baselinePaceSecPerKm: number; // 시간순 첫
  bestDistanceM: number;       // best 페이스 낸 활동의 실제 거리
  latestDistanceM: number;
  baselineDistanceM: number;
}
```

### 3.4 Riegel 예측

```ts
function riegelPredict(
  knownPaceSecPerKm: number,
  knownDistanceM: number,
  targetDistanceM: number
): number {
  // T1 = pace * distance_km, T2 = T1 * (D2/D1)^1.06
  const t1 = knownPaceSecPerKm * (knownDistanceM / 1000);
  const t2 = t1 * Math.pow(targetDistanceM / knownDistanceM, 1.06);
  return t2; // 초 단위 총 시간
}
```

### 3.5 Source bucket 선택 + confidence

```ts
function pickSource(target: Bucket, buckets: Map<Bucket, BucketSummary>): { source: Bucket; summary: BucketSummary } | null {
  // 1) 자체 bucket 우선
  const self = buckets.get(target);
  if (self && self.count > 0) return { source: target, summary: self };
  // 2) 다른 bucket 중 count 최대
  let best: { source: Bucket; summary: BucketSummary } | null = null;
  for (const [b, s] of buckets.entries()) {
    if (s.count === 0) continue;
    if (!best || s.count > best.summary.count) best = { source: b, summary: s };
  }
  return best;
}

function confidence(count: number): "high" | "medium" | "low" | null {
  if (count >= 5) return "high";
  if (count >= 2) return "medium";
  if (count >= 1) return "low";
  return null;
}
```

### 3.6 응답 스키마

```jsonc
{
  "date": "2026-07-01",
  "windowDays": 90,
  "predictions": {
    "5k": {
      "best":         { "timeSec": 1500, "timeFormatted": "25:00", "paceFormatted": "5:00", "confidence": "high", "basedOn": "5k best (5.02 km, 4:58 pace)" },
      "realistic":    { "timeSec": 1620, "timeFormatted": "27:00", "paceFormatted": "5:24", "confidence": "high", "basedOn": "5k latest (5.12 km, 5:26 pace)" },
      "conservative": { "timeSec": 1800, "timeFormatted": "30:00", "paceFormatted": "6:00", "confidence": "high", "basedOn": "5k baseline (5.05 km, 6:02 pace)" }
    },
    "10k": { ... },
    "HM": {
      "best":         { "timeSec": 6700, "timeFormatted": "1:51:40", "paceFormatted": "5:17", "confidence": "medium", "basedOn": "5k best via Riegel (5→21.0975km)" },
      ...
    },
    "FM": { "best": null, "realistic": null, "conservative": null }  // 데이터 없음
  },
  "sourceData": {
    "5k":  { "count": 12, "bestPaceFormatted": "4:58", "latestPaceFormatted": "5:26" },
    "10k": { "count": 4,  "bestPaceFormatted": "5:15", "latestPaceFormatted": "5:32" },
    "HM":  { "count": 0 },
    "FM":  { "count": 0 }
  }
}
```

## 4. 변경 파일

- `src/mcp/tools/race-prediction.ts` *(신규)*
- `src/mcp/server.ts` — `get_race_prediction` 등록
- `src/lib/ai/claude-advisor.ts` — `--allowedTools` 에 추가

## 5. 테스트 계획

`npm run lint && npm run typecheck && npm run build` 3종.

## 6. 제외 사항

- Cameron 공식 등 다른 예측 모델 — Riegel 로 충분
- 사용자 목표 date 기반 도달 가능 예측 — 별도 후속 (M6-1 계획과 통합)
- 페이스 개선 추세 반영 — realistic 이 latest 페이스라 이미 반영됨

## 7. 롤백

`git revert`. DB / env 영향 없음.
