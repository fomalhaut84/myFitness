# [M17 #2] HRR 해상도 2분 → 1분 — 1분 격자 소스 조사

- **작성일**: 2026-09-23
- **타입**: chore (조사 우선)
- **이슈**: #441 (P2)
- **브랜치**: 조사 단계는 브랜치 없음. 소스가 확인되면 `feat/441-1`
- **의존**: #418 (`recovery.ts` 오프셋 격자) · #425 (`hrr2` 컬럼 · `backfill:hrr`)
- **사용자 요청 (이슈 댓글 2026-09-23)**: 가민 기기에서 **데이터 기록을 "매초" 로 바꾸면** 1분 격자가 되는지 확인.

## 1. 배경

`src/lib/heart/recovery.ts` 는 하루치 심박 시계열 (`HeartRateRecord.rawData.heartRateValues`) 위에서 2분 배수 오프셋 (`−4 … +10`) 의 최근접 샘플 (±60초) 을 고르고, `hrr2` = 종료 − 2분 후 낙폭이다. #418 스펙은 "보간 · 리샘플 없음" 으로 못 박았다. 1분 HRR 로 가려면 **1분 격자의 실제 샘플**이 있어야 한다.

### 1-1. 조사 결과 (2026-09-23, 로컬 DB · 코드)

| 항목 | 결과 |
|---|---|
| 로컬 시계열 간격 (2026-04-01 ~ 04-07, 7일) | 연속 샘플 간격 **120초 = 4,787 / 4,795 (99.8%)**. 나머지 8건은 240 ~ 5,880초 (null 구간 · 워치 벗음). **60초 간격 0건** |
| 엔드포인트 | `@flow-js/garmin-connect` `getHeartRate(date)` → `wellness-service/wellness/dailyHeartRate?date=` — 해상도 파라미터 없음 (`UrlClass.js:192`). 응답 키: `heartRateValueDescriptors` · `heartRateValues` · `restingHeartRate` · `maxHeartRate` · `minHeartRate` · `lastSevenDaysAvgRestingHeartRate` |
| 워치 기록 설정 "매초" | Garmin 의 **Data Recording (Smart / Every Second)** 설정은 **활동 FIT 파일의 기록 간격**에 적용된다 (활동 중 GPS · 센서 샘플). 하루 심박 (wellness / monitoring 스트림) 은 별도 경로로, Connect 가 일별 심박 API 를 2분 격자로 내려주는 것은 워치 설정과 무관할 가능성이 높다 → **실측으로 확정** (§3 절차) |
| 활동 상세 (`activity-service/activity/{id}/details`) | 코드 미사용 (grep 0건). 초 단위 HR 이지만 **타이머 정지에서 끝난다** — 종료 후 샘플 없음 (418 스펙 · PR #422) |
| 워치 계산 회복 심박 | `Activity.rawData` 키 (로컬 최신 러닝 118개) 중 `recover*` · `hrr*` **0건**. `recoveryTime` 은 프로덕션 0 / 2,157. Connect 활동 JSON 에는 워치가 화면에 잠깐 보여주는 1분 회복값이 실리지 않는다 |

### 1-2. 대안 (소스 없을 때 · 참고)

- **행동 기반**: 러닝 종료 시 타이머를 바로 멈추지 않고 **랩 버튼 → 2분 서서 회복 → 저장**. 마지막 랩이 종료 후 구간이 되고 활동 상세 (초 단위) 에서 1분 HRR 을 계산할 수 있다. 단 활동의 `duration` · `avgPace` 가 바뀌고 (Garmin 도 그 랩을 활동에 포함), 상세 엔드포인트 호출 + 랩 판별 로직이 새로 필요하다. 이 이슈의 범위 밖 — 사용자가 원하면 별도 이슈.
- **보간**: 금지 (이슈 제외 항목).

## 2. 목표

1. "1분 격자 소스가 있는가" 에 **실측으로** 답한다. 특히 사용자가 물은 워치 "매초" 설정의 효과.
2. 있으면 1분 격자로 전환 (§4). 없으면 결론을 418 · 425 스펙과 이 문서에 적고 이슈를 닫는다.

## 3. 요구사항 — 조사 절차

- [ ] F1 **프로덕션 현재 분포** (설정 변경 전 기준값) — 사용자 실행:
  ```bash
  psql "$DATABASE_URL" -Atc "
  with s as (
    select r.date, (e->>0)::bigint as t
    from \"HeartRateRecord\" r, jsonb_array_elements(r.\"rawData\"->'heartRateValues') e
    where jsonb_typeof(r.\"rawData\"->'heartRateValues') = 'array'
  ), d as (
    select date, t - lag(t) over (partition by date order by t) as gap from s
  )
  select to_char(date, 'YYYY-MM') as ym,
         count(*) filter (where gap = 120000) as gap_120s,
         count(*) filter (where gap = 60000)  as gap_60s,
         count(*) filter (where gap not in (60000, 120000)) as other,
         count(distinct date) as days
  from d where gap is not null group by 1 order by 1;"
  ```
  기대: 전 월 `gap_60s = 0`. 어느 달이든 60s 가 나오면 그 기간의 기기 · 설정을 추적한다.
- [ ] F2 **워치 설정 실험** — 사용자: 워치 `설정 → 시스템 → 데이터 기록 → 매초` 로 변경 → 하루 착용 → 다음 06:00 cron 싱크 뒤 F1 쿼리를 그 날짜로 재실행:
  ```bash
  psql "$DATABASE_URL" -Atc "
  select (e->>0)::bigint/1000 - lag((e->>0)::bigint/1000) over (order by (e->>0)::bigint) as gap_sec, count(*) over ()
  from \"HeartRateRecord\" r, jsonb_array_elements(r.\"rawData\"->'heartRateValues') e
  where r.date = '<YYYY-MM-DD>'::date" | sort | uniq -c | sort -rn | head
  ```
  - 60초가 다수 → **소스 있음** → §4 로.
  - 여전히 120초 → 워치 설정은 wellness 해상도와 무관 → 결론 기록 · 종료. (배터리 소모가 커지므로 실험 뒤 설정을 되돌릴지 사용자 판단)
- [ ] F3 결론을 `418-hr-recovery.md` §7 · `425-hrr-trend.md` §7 · 이 문서 §5 에 기록. 소스 없음이면 이슈 닫음 (PR 은 문서만 · self-review).

## 4. 소스가 있을 때의 변경 (조건부)

`recovery.ts` 의 격자를 **샘플 간격에서 유도**한다 — 하드코딩 1분이 아니라 "시계열의 최빈 간격" 을 재고 그 배수 오프셋을 쓴다. 과거 (2분) 와 미래 (1분) 데이터가 한 DB 에 공존하기 때문이다.

- `detectGridMs(series)` — 연속 간격의 최빈값 (60,000 또는 120,000, 그 외는 120,000 폴백)
- 오프셋: 1분 격자면 `−2, −1, 0, 1, 2, 3, 5, 10` · 2분 격자면 현행. 허용 오차 = 격자 / 2
- `Activity.hrr1 Int?` 추가 (수동 SQL · `prisma-drift-fix`) — `hrr2` 는 유지 (전 기간 비교 가능한 값). 1분 격자에서만 채워진다
- `fillRecoveryColumns` · `backfill:hrr` 가 `hrr1` 도 채움 · 활동 상세 곡선은 격자에 맞춰 점 개수 변경 · 캡션 "1분 해상도" / "2분 해상도" 를 데이터에서
- `/insights` 패널 E 는 `hrr2` 그대로 (연도 비교의 일관성). `hrr1` 패널은 데이터가 1년 쌓인 뒤
- 회귀 테스트: `detectGridMs` (1분 · 2분 · 혼합 · null 구간) · 1분 격자 곡선 · 2분 데이터에서 `hrr1 = null`

## 5. 결론

_(F2 실측 뒤 기록)_

## 6. 제외 사항

- 2분 격자에서 1분 값을 만드는 보간 · 리샘플
- 행동 기반 대안 (§1-2) 의 구현
