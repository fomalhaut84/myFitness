# M2-8 후속: 자동 싱크 endDate를 어제(KST)로 좁히고 fetcher 미래 가드 일관성 보강

## 배경

M2-8(`docs/specs/m2-8-date-fix.md`)에서 KST 기준 날짜 유틸과 fetcher 미래 날짜 가드를 도입했다.
실효성은 확보했지만 두 가지 일관성 미흡이 남아 있다.

1. **자동 cron 싱크 endDate 의미 불명확**
   - `src/lib/cron.ts`가 `endDate = todayKST()`로 호출하여 "오늘"까지 요청한다.
   - 의도는 "완전한 데이터(어제까지)"이며, 미래 날짜 차단은 fetcher 단(`if calendarDate > todayKSTString()`)에서 우연히 막아주고 있을 뿐이다.
   - 6시 KST 직후라면 Garmin이 "오늘 calendarDate"의 매우 부분적인 데이터(0~6시)를 반환할 수 있는데, 이는 cron이 매 3시간마다 다시 가져올 것이므로 의미가 없다.
   - 수동/모닝 리포트용 사전 싱크에서는 명시적으로 `todayKST()`를 호출하므로, cron만 어제까지로 좁히는 게 의미적으로 정확하다.

2. **`syncAll`의 endDate 기본값 의미 불명확**
   - `src/lib/garmin/sync.ts`에서 endDate가 생략되면 `todayKST()`로 폴백한다.
   - 호출자가 모두 명시하므로 실효 영향은 없으나, "안전한 기본값"이라는 관점에서 `yesterdayKST()`가 더 적절(완전 데이터 기준).

3. **`heart-rate`/`body-composition` fetcher에 미래 날짜 가드 없음**
   - `daily-summary`/`sleep`/`blood-pressure`/`activities`는 미래 날짜 가드를 갖고 있다.
   - `heart-rate`는 `dateRange(startDate, endDate)`로 명시적 날짜만 순회하므로 호출자가 미래를 안 넘기면 OK이지만, 일관성 차원에서 가드 필요.
   - `body-composition`은 Garmin 응답의 `entry.date`가 endDate 이후를 포함할 가능성이 낮으나, 동일하게 가드를 추가해 일관성 확보.

## 요구사항

- [ ] `src/lib/cron.ts`: 자동 싱크 `endDate`를 `yesterdayKST()`로 변경
- [ ] `src/lib/garmin/sync.ts`: 기본 `endDate` 폴백을 `yesterdayKST()`로 변경
- [ ] `src/lib/garmin/fetchers/heart-rate.ts`: 루프 내부에서 `formatDate(date) > todayKSTString()` 항목 skip
- [ ] `src/lib/garmin/fetchers/body-composition.ts`: 응답 항목 중 `dayDate > today(KST midnight)` 항목 skip

## 비목표

- 수동 싱크(`/api/sync`)와 리포트 사전 싱크(`preSyncForReport`)는 그대로 `todayKST()` 유지 (사용자가 의도적으로 오늘 부분 데이터를 원함).
- KST 유틸 함수 추가/변경 없음 (M2-8에서 완료).

## 기술 설계

### cron 변경

```ts
// src/lib/cron.ts
const { daysAgoKST, yesterdayKST } = await import("@/lib/garmin/utils");
const results = await syncAll({
  startDate: daysAgoKST(2),
  endDate: yesterdayKST(),
  bootstrapNewTypes: true,
});
```

`startDate=2일 전, endDate=어제` → 어제와 그제 두 날 데이터만 갱신.
신규 타입은 `bootstrapNewTypes`로 365일 초기 로드.

### sync.ts 기본값

```ts
// src/lib/garmin/sync.ts
const endDate = options?.endDate ?? yesterdayKST();
```

방어적 폴백. 모든 호출자가 endDate를 명시하므로 실제 영향은 없지만, 누락 시 안전한 쪽으로.

### heart-rate 가드

```ts
// src/lib/garmin/fetchers/heart-rate.ts
import { ..., todayKSTString, formatDate } from "../utils";

for (const date of dates) {
  if (formatDate(date) > todayKSTString()) continue;
  // ...
}
```

### body-composition 가드

```ts
// src/lib/garmin/fetchers/body-composition.ts
import { ..., todayKSTString, formatDate } from "../utils";

for (const entry of response.dateWeightList) {
  // ...
  const dayDate = startOfDay(entryDate);
  if (formatDate(dayDate) > todayKSTString()) continue;
  // ...
}
```

## 테스트 계획

1. `npm run lint && npx tsc --noEmit && npm run build` 통과
2. 수동 호출 (`POST /api/sync` body 없이) → 여전히 오늘(KST)까지 싱크되는지 확인
3. cron 단위 동작 확인 (로그상 endDate가 어제 날짜로 표시)
4. 리포트 재생성 시 preSync가 오늘(KST)까지 동작하는지 (`generateMorningReport(true)`)

## 제외 사항

- 미래 날짜 데이터가 DB에 이미 들어갔을 경우의 백필/정리 → 수동 SQL로 별도 처리, 본 이슈 범위 외.
