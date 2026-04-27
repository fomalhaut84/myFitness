# M2-8 후속: fetcher 미래 날짜 가드 일관성

## 배경

M2-8(`docs/specs/m2-8-date-fix.md`)에서 KST 기준 날짜 유틸과 일부 fetcher의 미래 날짜 가드(`daily-summary`, `sleep`, `blood-pressure`, `activities`)를 도입했다.
나머지 두 fetcher(`heart-rate`, `body-composition`)에는 동일한 가드가 빠져 있어 일관성 측면에서 보강이 필요하다.

> **참고:** 본 PR 초안에서는 cron 자동 싱크 endDate를 `yesterdayKST()`로 좁혀 "완전 데이터만 갱신" 의도를 명시하려 했으나,
> codex 리뷰에서 다음 두 회귀가 지적되어 원안으로 복원:
> - **P1 (sync.ts):** `syncAll` 기본 endDate를 어제로 바꾸면 endDate 미명시 호출자(`scripts/sync-garmin.ts`)가 오늘 데이터를 누락.
> - **P2 (cron.ts):** cron이 어제까지로만 호출하면 `body_composition`/`blood_pressure` 오늘 데이터가 자동 경로로 갱신되지 않음 (`preSyncForReport`도 두 타입 미포함).
>
> 따라서 cron / `syncAll` 기본값 모두 `todayKST()` 유지. 미래 날짜는 각 fetcher의 calendarDate 가드가 책임.

## 요구사항

- [x] `src/lib/garmin/fetchers/heart-rate.ts`: 루프 내부에서 `formatDate(date) > todayKSTString()` 항목 skip
- [x] `src/lib/garmin/fetchers/body-composition.ts`: 응답 항목 중 `dayDate > today(KST)` 항목 skip
- [x] `src/lib/cron.ts` / `src/lib/garmin/sync.ts` 의도 코멘트 정리 ("미래 날짜는 fetcher가 막음")

## 비목표

- cron / `syncAll` endDate 변경 (위 회귀로 인해 보류)
- KST 유틸 함수 추가/변경 없음 (M2-8에서 완료)

## 기술 설계

### heart-rate 가드

```ts
// src/lib/garmin/fetchers/heart-rate.ts
import { ..., formatDate, todayKSTString } from "../utils";

for (const date of dates) {
  if (formatDate(date) > todayKSTString()) continue;
  // ...
}
```

### body-composition 가드

```ts
// src/lib/garmin/fetchers/body-composition.ts
import { ..., todayKSTString } from "../utils";

for (const entry of response.dateWeightList) {
  // ...
  const dayDate = startOfDay(entryDate);
  if (formatDate(dayDate) > todayKSTString()) continue;
  // ...
}
```

## 테스트 계획

1. `npm run lint && npx tsc --noEmit && npm run build` 통과
2. cron 자동 싱크 동작에 회귀 없는지 확인 (오늘 부분 데이터 갱신 유지)
3. `scripts/sync-garmin.ts --days=1` 실행 시 오늘 데이터 포함되는지 확인

## 제외 사항

- 미래 날짜 데이터가 DB에 이미 들어갔을 경우의 백필/정리 → 수동 SQL로 별도 처리.
