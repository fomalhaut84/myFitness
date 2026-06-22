# M5-2-3: `get_pace_progression` MCP 도구

- **작성일**: 2026-06-22
- **타입**: feature (P1)
- **마일스톤**: M5-2 (`docs/specs/m5-overview.md`)
- **백엔드 전용**

## 1. 목적

동일 거리(5k/10k/HM) 러닝 페이스 추세를 결정적으로 산출. AI가 주간 리포트에서 "지난 분기 대비 페이스 % 향상" 같은 진척도 평가를 일관되게 제공.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 신규 MCP 도구 `get_pace_progression`. 입력 파라미터 `windowDays`(default 90, 30~365 범위).
- [ ] **F2**: 데이터 소스 = `Activity` 중 `activityType` 가 러닝 계열(`running`, `treadmill_running`, `trail_running`). `distance`/`avgPace` 모두 not null.
- [ ] **F3**: 거리 bucket 분류:
  - `5k`: `[4.5, 5.5)` km
  - `10k`: `[9.0, 11.0)` km
  - `HM`: `[20.0, 22.0)` km (half marathon)
  - `FM`: `[40.0, 44.0)` km (full marathon)
  - 위 외는 unbucketed (응답 미포함)
- [ ] **F4**: 각 bucket 산출:
  - `count`: 활동 수
  - `baseline`: 윈도우 내 가장 오래된 활동(시간순 첫 활동)의 페이스
  - `latest`: 가장 최근 활동의 페이스
  - `best`: 가장 빠른(낮은 avgPace) 활동의 페이스
  - `improvementPct`: `(baselinePace - latestPace) / baselinePace * 100`, 양수=빨라짐
  - 활동 1건이면 baseline=latest=best 동일, improvementPct=0
- [ ] **F5**: 보조: `recentRuns` — 최근 5건 러닝 (모든 거리, bucket 표기 포함)
- [ ] **F6**: 페이스 표시: `paceSecPerKm` (raw) + `paceFormatted` (`"M:SS"` 예: `4:30`)

### 2.2 비기능

- KST 기준 (windowDays 일 이전부터 오늘까지)
- DB 쿼리 1건 (해당 윈도우 + 러닝 + distance/avgPace not null)
- 데이터 없는 bucket은 응답에서 제외 (단 빈 객체보단 키 자체 omit)

## 3. 기술 설계

### 3.1 윈도우 + 필터

```ts
const since = daysAgoKST(windowDays - 1); // 오늘 포함 N일
const tomorrow = todayKST + 1 day;
const runs = await prisma.activity.findMany({
  where: {
    startTime: { gte: since, lt: tomorrow },
    activityType: { in: ["running", "treadmill_running", "trail_running"] },
    distance: { not: null },
    avgPace: { not: null },
  },
  select: { startTime, distance, avgPace, activityType },
  orderBy: { startTime: "asc" },
});
```

### 3.2 bucket 분류

```ts
function bucketOf(distanceM: number): "5k" | "10k" | "HM" | "FM" | null {
  const km = distanceM / 1000;
  if (km >= 4.5 && km < 5.5) return "5k";
  if (km >= 9.0 && km < 11.0) return "10k";
  if (km >= 20.0 && km < 22.0) return "HM";
  if (km >= 40.0 && km < 44.0) return "FM";
  return null;
}
```

### 3.3 페이스 포맷

```ts
function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}
```

### 3.4 bucket 산출

활동을 bucket으로 그룹핑 → 각 그룹에서:
- `baseline` = 시간순 첫 활동 (orderBy asc 기준 `[0]`)
- `latest` = 시간순 마지막 활동 (orderBy asc 기준 `[length-1]`)
- `best` = `avgPace` 최소
- `improvementPct` = baseline/latest 비교

```ts
function summarizeBucket(runs: Activity[]): BucketSummary {
  // runs는 orderBy startTime asc 보장
  const baseline = runs[0];
  const latest = runs[runs.length - 1];
  const best = runs.reduce((a, b) => (a.avgPace! < b.avgPace! ? a : b));
  const improvementPct =
    baseline.avgPace! > 0
      ? round(((baseline.avgPace! - latest.avgPace!) / baseline.avgPace!) * 100, 1)
      : 0;
  return {
    count: runs.length,
    baseline: { date: ymdKST(baseline.startTime), paceSecPerKm: Math.round(baseline.avgPace!), paceFormatted: formatPace(baseline.avgPace!) },
    latest: { date: ymdKST(latest.startTime), paceSecPerKm: Math.round(latest.avgPace!), paceFormatted: formatPace(latest.avgPace!) },
    best: { date: ymdKST(best.startTime), paceSecPerKm: Math.round(best.avgPace!), paceFormatted: formatPace(best.avgPace!) },
    improvementPct,
  };
}
```

### 3.5 응답 스키마

```jsonc
{
  "date": "2026-06-22",
  "windowDays": 90,
  "buckets": {
    "5k":  { count, baseline, latest, best, improvementPct },
    "10k": { ... },
    "HM":  { ... },
    "FM":  { ... }
  },
  "recentRuns": [
    { "date": "2026-06-21", "distanceKm": 5.12, "paceSecPerKm": 270, "paceFormatted": "4:30", "bucket": "5k" },
    ...  // 최대 5건
  ]
}
```

활동이 0건이면 `buckets` 빈 객체 + `recentRuns` 빈 배열.

## 4. 변경 파일

- `src/mcp/tools/pace-progression.ts` *(신규)*
- `src/mcp/server.ts` — `get_pace_progression` 등록 + `--allowedTools` 추가

## 5. 테스트 계획

`npm run lint && npm run typecheck && npm run build` 3종 통과.

## 6. 제외 사항

- 페이스 그래프 / UI 시각화
- Garmin "Race Predictor" 통합 — 별도 백로그
- 거리 bucket 사용자 정의

## 7. 롤백

`git revert`. DB 영향 없음.
