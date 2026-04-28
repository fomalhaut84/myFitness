# M2-8 후속3: calorie-balance / sleep 잔여 KST 정합

## 배경

PR #91에서 `utils.startOfDay/dateRange/formatDate`를 KST-aware로 통일했으나, 두 곳에서 여전히 서버 로컬 midnight Date를 만들고 있어 다른 fetcher가 저장한 KST midnight UTC instant와 키 어긋남이 발생할 수 있다.

### (1) `src/lib/garmin/fetchers/sleep.ts:31-32`
```ts
const [year, month, day] = calendarDate.split("-").map(Number);
const dayDate = new Date(year, month - 1, day);
dayDate.setHours(0, 0, 0, 0);
```
`new Date(year, month-1, day)`는 서버 로컬 midnight이라 서버가 KST일 때만 정합. `daily-summary` / `blood-pressure` / `body-composition` / `heart-rate`는 `startOfDay()`(KST-aware) 사용.

### (2) `src/lib/fitness/calorie-balance.ts:34`
```ts
const summaryKey = new Date(y, m - 1, d, 0, 0, 0, 0);
```
같은 이유. 서버 KST 환경 가정으로 작성됐고 코멘트에도 명시. `DailySummary` 키가 이제 KST midnight UTC instant이므로 UTC 호스트에서 키 미스. `tx.dailySummary.findUnique({ where: { date: summaryKey } })` miss → 칼로리 밸런스 재계산 silent skip.

### 영향
- 서버 KST 환경(현재 운영)에서는 외형 동일 → 회귀 없음.
- UTC 등 다른 타임존 호스트로 옮길 때만 발현.
- 그러나 코드 일관성 + 이식성 차원에서 정리 필요.

## 요구사항

- [ ] `sleep.ts`: `calendarDate` string에서 KST midnight UTC instant Date 생성
- [ ] `calorie-balance.ts`: `summaryKey`를 KST midnight UTC instant로 변경 + 코멘트 갱신
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과

## 비목표

- `asOfDate`를 리포트 생성 파이프라인 전체로 관통 (별도 큰 작업)
- 기존 DB record 마이그레이션 (서버 KST 환경에선 instant 동일이라 영향 없음)

## 기술 설계

### sleep.ts

```ts
// calendarDate = "YYYY-MM-DD" → KST midnight UTC instant
const dayDate = new Date(`${calendarDate}T00:00:00+09:00`);
```

또는 `startOfDay(new Date(year, month-1, day))` 사용 (다른 fetcher와 동일 패턴).
ISO offset 직접 사용이 더 짧고 명확하므로 첫 번째 채택.

### calorie-balance.ts

```ts
// 서버 TZ 무관 KST midnight UTC instant
// DailySummary.date 저장 관례(=KST midnight instant, by utils.startOfDay)와 정합.
const summaryKey = new Date(
  `${parts.find(...year)}-${...month}-${...day}T00:00:00+09:00`
);
```

`ymdKST(referenceDate)` 결과 string을 그대로 ISO offset에 붙이면 더 단순:

```ts
const ymd = ymdKST(referenceDate);
const summaryKey = new Date(`${ymd}T00:00:00+09:00`);
```

`kstDayStart`/`kstDayEnd`는 기존 로직 유지(이미 KST midnight UTC instant).

## 테스트 계획

1. 정적 검사 통과
2. 서버 KST 환경에서 외형 동작 동일 확인 (DailySummary 저장/조회 정상)
3. UTC 시뮬레이션: `summaryKey`와 fetcher의 `dayDate`가 같은 instant인지 확인
