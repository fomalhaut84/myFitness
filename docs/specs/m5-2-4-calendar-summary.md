# M5-2-4: `get_calendar_summary` MCP 도구

- **작성일**: 2026-06-22
- **타입**: feature (P1)
- **마일스톤**: M5-2 마지막 (`docs/specs/m5-overview.md`)
- **백엔드 전용**

## 1. 목적

AI가 주간/월간 리포트에서 "지난 N일 일자별 상황" 을 빠르게 훑을 수 있도록 핵심 지표를 1줄씩 N건 일괄 제공. 기존엔 `get_sleep` + `get_daily_stats` + `get_activities` 각각 호출하고 AI가 메모리에서 일자별로 머지 — 토큰 낭비 + AI 매칭 오류 가능.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 신규 MCP 도구 `get_calendar_summary`. 입력 `days` (default 14, 1~90).
- [ ] **F2**: N일 일자별 한 줄 객체 배열 (최신순). 각 일자:
  - `date`: YYYY-MM-DD (KST)
  - `runningKm`: 그날 러닝 거리 합계 (소수 2자리, 활동 없으면 0)
  - `runningCount`: 러닝 활동 수
  - `restingHR`: SleepRecord 우선, fallback DailySummary (정수, null 가능)
  - `sleepScore`: 정수, null 가능
  - `sleepHours`: 시간 단위 소수 1자리, null 가능
  - `bodyBatteryHigh`: 정수, null 가능
  - `calorieBalance`: 정수, null 가능 (M4-2 필드, 음수=결손/감량 방향)
  - `steps`: 정수, null 가능
- [ ] **F3**: 응답 envelope에 `summary` 추가:
  - `totalRunningKm`, `totalRunningCount`, `daysWithRun`, `avgSleepScore` (null 제외 평균)

### 2.2 비기능

- KST 기준 일자
- DB 쿼리 3건 병렬 (Activity 러닝, SleepRecord, DailySummary)
- 응답 토큰 ≤ 1500 (90일 시 ~3000, 다소 부담이지만 days=14 default라 일반은 ≤500)

## 3. 기술 설계

### 3.1 윈도우

```ts
const days = Math.min(90, Math.max(1, args.days ?? 14));
const since = daysAgoKST(days - 1); // 오늘 포함 N일
const tomorrow = todayKST() + 1 UTC day;
```

### 3.2 데이터 조회 (Promise.all 3건)

```ts
const [runs, sleeps, dailies] = await Promise.all([
  prisma.activity.findMany({
    where: {
      startTime: { gte: since, lt: tomorrow },
      activityType: { contains: "running" },
    },
    select: { startTime, distance },
  }),
  prisma.sleepRecord.findMany({
    where: { date: { gte: since, lt: tomorrow } },
    select: { date, sleepScore, totalSleep, restingHR },
  }),
  prisma.dailySummary.findMany({
    where: { date: { gte: since, lt: tomorrow } },
    select: { date, restingHR, bodyBatteryHigh, calorieBalance, steps },
  }),
]);
```

### 3.3 일별 머지

각 데이터를 `Map<YYYY-MM-DD, ...>` 로 인덱싱 후 N일 윈도우 순회.

```ts
const runMap = new Map<string, { distanceM: number; count: number }>();
for (const r of runs) {
  const key = ymdKST(r.startTime);
  const entry = runMap.get(key) ?? { distanceM: 0, count: 0 };
  entry.distanceM += r.distance ?? 0;
  entry.count++;
  runMap.set(key, entry);
}

const sleepMap = new Map<string, typeof sleeps[number]>();
for (const s of sleeps) sleepMap.set(ymdKST(s.date), s);

const dailyMap = new Map<string, typeof dailies[number]>();
for (const d of dailies) dailyMap.set(ymdKST(d.date), d);
```

### 3.4 윈도우 순회 (최신순)

```ts
const today = todayKST();
const items = [];
for (let i = 0; i < days; i++) {
  const dayInstant = new Date(today);
  dayInstant.setUTCDate(dayInstant.getUTCDate() - i);
  const key = ymdKST(dayInstant);
  const run = runMap.get(key);
  const sleep = sleepMap.get(key);
  const daily = dailyMap.get(key);
  items.push({
    date: key,
    runningKm: run ? round(run.distanceM / 1000, 2) : 0,
    runningCount: run?.count ?? 0,
    restingHR: sleep?.restingHR ?? daily?.restingHR ?? null,
    sleepScore: sleep?.sleepScore ?? null,
    sleepHours: sleep?.totalSleep ? round(sleep.totalSleep / 60, 1) : null,
    bodyBatteryHigh: daily?.bodyBatteryHigh ?? null,
    calorieBalance: daily?.calorieBalance ?? null,
    steps: daily?.steps ?? null,
  });
}
```

### 3.5 summary 산출

```ts
const totalRunningKm = round(items.reduce((a, b) => a + b.runningKm, 0), 2);
const totalRunningCount = items.reduce((a, b) => a + b.runningCount, 0);
const daysWithRun = items.filter((i) => i.runningCount > 0).length;
const sleepScores = items.map((i) => i.sleepScore).filter((s): s is number => s !== null);
const avgSleepScore =
  sleepScores.length > 0
    ? Math.round(sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length)
    : null;
```

### 3.6 응답 스키마

```jsonc
{
  "date": "2026-06-22",
  "days": 14,
  "summary": {
    "totalRunningKm": 50.25,
    "totalRunningCount": 8,
    "daysWithRun": 7,
    "avgSleepScore": 78
  },
  "items": [
    {
      "date": "2026-06-22",
      "runningKm": 5.12,
      "runningCount": 1,
      "restingHR": 52,
      "sleepScore": 82,
      "sleepHours": 7.3,
      "bodyBatteryHigh": 86,
      "calorieBalance": -350,
      "steps": 12450
    },
    ...
  ]
}
```

## 4. 변경 파일

- `src/mcp/tools/calendar.ts` *(신규)*
- `src/mcp/server.ts` — 등록 + zod schema
- `src/lib/ai/claude-advisor.ts` — allowedTools 추가

## 5. 테스트 계획

lint/typecheck/build 3종.

## 6. 제외 사항

- 시각화/타임라인 UI
- 식단 상세 (M4-3 의존)
- 90일 이상 윈도우 (페이로드 부담)

## 7. 롤백

`git revert`. DB 영향 없음.
