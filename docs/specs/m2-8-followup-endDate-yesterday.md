# M2-8 후속: body-composition fetcher 미래 instant 가드

## 배경

M2-8(`docs/specs/m2-8-date-fix.md`)에서 일부 fetcher(`daily-summary`, `sleep`, `blood-pressure`, `activities`)에 미래 날짜 가드를 도입했다.
나머지 두 fetcher(`heart-rate`, `body-composition`) 중 `body-composition`은 Garmin이 epoch ms로 entry를 반환하므로 미래 instant이 들어올 가능성이 있어 가드를 추가한다.

## 비목표

`heart-rate` 가드는 추가하지 않는다. 이유:
- `dateRange()`가 만든 dates는 호출자가 통제하는 endDate에서 파생되므로 호출자가 미래 endDate를 명시하지 않는 한 미래 호출이 발생하지 않음.
- `todayKST()/daysAgoKST()`가 만든 Date는 진짜 KST midnight이 아니라 "서버 로컬로 해석된 KST 벽시계 시각"이라, instant/calendar 어느 비교든 서버 타임존에 따라 어긋날 수 있음 (codex 리뷰 P2 5건 누적).
- 정확한 KST 정합성은 utils의 `*KST` 함수 재설계가 선행되어야 함 — 본 PR 범위 외.

또한 cron / `syncAll` endDate 변경도 비목표:
- **P1**: `syncAll` 기본 endDate 어제 변경 시 `scripts/sync-garmin.ts` 등 endDate 미명시 호출자 회귀
- **P2**: cron 어제 변경 시 `body_composition`/`blood_pressure` 오늘 데이터가 자동 경로로 갱신 안 됨

## 요구사항

- [x] `src/lib/garmin/fetchers/body-composition.ts`: Garmin entry epoch ms가 미래 instant이면 skip
- [x] `src/lib/cron.ts` / `src/lib/garmin/sync.ts` 의도 코멘트 정리

## 기술 설계

### body-composition 가드

```ts
const entryDate = new Date(entry.date);
const dayDate = startOfDay(entryDate);

// 미래 instant 방지 (서버 타임존 무관 절대 시각 비교)
if (entryDate.getTime() > Date.now()) continue;
```

`entry.date`가 진짜 epoch ms라 instant 비교가 정확.

## 테스트 계획

1. `npm run lint && npx tsc --noEmit && npm run build` 통과
2. cron / 수동 싱크 / `scripts/sync-garmin.ts` 회귀 없음 확인

## 제외 사항

- `heart-rate` fetcher 가드 (위 비목표 참조)
- utils `*KST` 함수 재설계 (별도 이슈)
- 미래 날짜 데이터 백필/정리
