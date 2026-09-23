# [M16 #2] `/insights` 연도별 HRR 추이 — `Activity.hrr2` 승격 + 백필 + "회복이 빨라졌나?" 패널

- **작성일**: 2026-09-23
- **타입**: feature
- **이슈**: #425
- **브랜치**: `feat/425-1`
- **의존**: #418 (v2.35.0 — `src/lib/heart/recovery.ts` 순수 로직 재사용) · #397 (`/insights` 패널 언어 · `InsightScatter` · `ValueTable`)

## 1. 배경

#418 은 러닝 1건의 종료 후 회복 곡선을 활동 상세에 그렸다 (서버에서 활동마다 하루치 시계열 1~2행을 읽음). "회복이 **빨라졌나**" 는 6년치 러닝 2,157건의 2분 HRR 을 한 번에 봐야 하는데, 러닝마다 하루치 시계열 (~15KB) 을 읽으면 페이지 로드가 30MB 가 넘는다 → 값을 `Activity` 컬럼으로 승격해 두고 `/insights` 는 컬럼만 읽는다.

프로덕션 실측 (2026-09-23, v2.35.0 배포 후):

| 확인 | 결과 |
|---|---|
| `heartRateValues` 시작일 · 일수 | **2020-06-18 · 2,288일** — 러닝 전 기간 (2020-06~) 커버 |
| Garmin `recoveryTime` | 0 / 2,157 — 대조 불가, 2분 HRR 이 정본 |
| 연도별 샘플 수 (2분 격자 여부) | §7 배포 전 확인 쿼리 — 하루 ~700 이면 동일 격자 |

실코드 재검증:

| 지점 | 현황 |
|---|---|
| 싱크 순서 | `SYNC_ORDER` = daily_stats → activities → sleep → heart_rate. 심박이 **마지막** — 활동 fetcher 안에서는 그 날 심박이 아직 없을 수 있다 → `syncAll` 끝에서 후처리 |
| 저녁 러닝 직후 싱크 (cron 21:00) | 하루치 심박이 부분이라 +2 분 샘플이 없으면 `hrr2 = null` (잘못된 값이 아니라 결측). 다음 싱크 창 (`lastSyncDate + 1` = 오늘) 에는 어제 활동이 안 들어오므로 후처리 창을 **시작일 − 2일** 로 넓힌다 |
| 캐시 | `getCachedInsightRuns` 키 = 싱크 stamp (`max(lastSyncAt)`) + 수동 쓰기 버전. 후처리는 stamp 갱신 **뒤** 에 돌므로 `bumpHistoryCacheVersion()` 을 호출한다. 백필 스크립트는 별 프로세스라 못 올린다 — TTL 10분 또는 `pm2 restart` |
| `Activity.rawData` | `elapsedDuration` 이 여기 있어 활동마다 rawData 를 읽어야 한다 (split 포함 10~30KB). 백필은 200건 청크 커서 |
| `InsightScatter` | x 는 숫자 축 · 눈금 자동. 날짜 축은 **소수 연도** (`2024.53`) 로 넘기고 `AxisFormat "year"` + 명시 눈금 (`x.ticks`) 을 추가한다 |
| 백필 스크립트 선례 | `scripts/backfill-event-type.ts` — `--limit` · `--after-id` composite cursor · `--dry-run` · `--force` |

## 2. 목표

1. 러닝 2,157건 전부에 `hrr2` · `hrrDrop10` 이 채워진다 (API 호출 0 · 백필 1회 · 이후 싱크가 자동 채움).
2. `/insights` 5번째 패널 "회복이 빨라졌나?" — 점 = 러닝, 연도별 중앙값 표 + 큰 숫자 하나.
3. 계산은 `src/lib/heart/` · `src/lib/insights/` 순수 함수 + vitest. 부분 데이터에서 잘못된 값을 저장하지 않는다.

## 3. 요구사항

> **구현 (feat/425-1, 2026-09-23).** 순수 로직 vitest 12건 추가 (230건) · 로컬 마이그레이션 apply → `backfill:hrr` (러닝 5건 · 활동 상세 곡선과 값 일치: 04-05 hrr2 16 · 10분 낙차 48) → `/insights` 패널 E 실화면 확인 (데스크톱 1040 · 폰 360). 달라진 항목은 ↳.

**스키마**
- [x] F1 `Activity.hrr2 Int?` · `Activity.hrrDrop10 Int?` — nullable · additive · 인덱스 없음 (러닝 + 기간 필터만). 수동 SQL migration (`prisma-drift-fix`) · `prisma generate`
  - `hrr2` = 종료 − 2분 후 (양수 = 회복 · 음수 허용). `hrrDrop10` = 종료 − 10분 후. 둘 다 `recoveryCurve` 의 값 그대로

**채움 (`src/lib/heart/fill-recovery.ts`, prisma)**
- [x] F2 `fillRecoveryColumns({ from, to, force?, dryRun?, batchSize? })` — 러닝 (`RUNNING_ACTIVITY_WHERE`) · `startTime ∈ [from, to)` · `force` 아니면 `hrr2 IS NULL` 만. 청크 (200) 커서 `(startTime, id)`. 청크마다 필요한 KST 일자 (`recoveryDayKeys`) 를 모아 `HeartRateRecord` 를 한 번에 읽고 (`date in [...]`) 활동별로 합쳐 `recoveryCurve`. 반환 `{ candidates, updated, missing (레코드 없음), skipped (곡선 결측) }`
  - 레코드가 없거나 0 · +2 분이 결측이면 **null 그대로 둔다** (다음 싱크가 다시 시도) — 부분 데이터로 0 을 쓰지 않는다
  - `hrrDrop10` 은 `hrr2` 와 독립 (10 분 샘플만 결측이면 `hrr2` 는 쓰고 `hrrDrop10` 은 null)
- [x] F3 `syncAll` 후처리 — 루프에서 `activities` · `heart_rate` 가 실제로 돈 최소 `startDate` 를 기억해, 루프 뒤 `fillRecoveryColumns({ from: min − 2일, to: endDate + 1일 })` 를 **await** (DB 만 · 수 건). 갱신 > 0 이면 `bumpHistoryCacheVersion()`. 실패는 로그만 (싱크 결과에 영향 X)
- [x] F4 `scripts/backfill-hrr.ts` (`npm run backfill:hrr`) — `--from YYYY-MM-DD` (기본 하한) · `--to` (기본 오늘) · `--force` · `--dry-run` · `--limit N`. 종료 시 집계 출력. 프로덕션 실행 후 `pm2 restart` (캐시)

**`/insights` 패널 E — "회복이 빨라졌나?"**
- [x] F5 `InsightRun` 에 `hrr2: number | null` 추가 (`loadInsightRuns` select 1개 추가 · 조회 1회 유지)
- [x] F6 순수 `src/lib/insights/recovery.ts`: `recoveryPoints(runs)` (hrr2 있는 러닝 · 거리 필터 없음 — 트레드밀도 HRR 은 유효) · `recoveryByYear(points, years)` → `{ year, n, medianHrr2 }` (5건 미만 해 null · `MIN_YEAR_RUNS` 상수 공유) · `recoveryDelta(years)` (첫 유효 해 vs 마지막 유효 해 중앙값 차)
- [x] F7 차트: `InsightScatter` — x = 소수 연도 (`year + dayOfYear/365`), y = `hrr2` bpm, 계열 = 연도 (YoY 규칙 · 심박 색), 레이스는 속 빈 점 (A 패널과 동일), **연도 중앙값** 은 계열 하나 `중앙값` (밝은 색 · 큰 속 빈 점 · x = 연도 + 0.5). x 축 눈금 = 정수 연도 (`AxisFormat "year"` · `x.ticks`)
  - ↳ `ScatterSeries.emphasis` (큰 속 빈 점 r 6 · 범례 링) · `ScatterAxis.ticks` · `ScatterAxis.domain` (시간 축은 `[첫 해, 마지막 해 + 1]` — 한 해뿐이면 자동 도메인이 너무 좁아 눈금이 사라진다) · `ScatterAxis.zeroLine` (`ReferenceLine y=0`, 범위 밖이면 안 그려짐)
- [x] F8 판독값: `BigNumber` "올해 vs 첫 해 중앙값 +N bpm" (효율 패널의 `effDelta` 문구 규칙 — 마지막 유효 해가 올해가 아닐 수 있다) + `ValueTable` 연도별 중앙값 (n 병기 · 5건 미만 `—`)
- [x] F9 `how`/`foot` 문구: "점 = 러닝 1건. 세로 = 종료 2분 뒤 심박이 얼마나 떨어졌나 (2분 HRR · 클수록 빠른 회복)". foot: "중앙값 — 인터벌 · 레이스처럼 고심박에서 멈춘 러닝은 HRR 이 크게 나와 평균을 끌어올립니다. 2분 해상도라 워치의 1분 HRR 과 다릅니다. 하루 심박이 없는 날의 러닝은 빠집니다 (n 참조)"
- [x] F10 빈 상태: hrr2 있는 러닝 0건 → "종료 후 심박이 계산된 러닝이 없습니다 — `backfill:hrr` 실행 후 보입니다"

**디자인 · 문서**
- [x] F11 시안 `docs/designs/425-hrr-trend/` — 397 패널 언어 (질문 → 차트 → 답), 패널 1개
- [x] F12 #427 반영 (로드맵 `# 마일스톤 16` 헤딩 · 인계 문서 후보 표 문구) — 이 브랜치의 문서 커밋에서

## 4. 기술 설계

```
syncAll (sync.ts)
  └─ 루프 뒤: fillRecoveryColumns({ from: minStart − 2d, to: end + 1d })  → bumpHistoryCacheVersion()
scripts/backfill-hrr.ts ─┘ 같은 함수 · 넓은 기간

src/lib/heart/
  recovery.ts          (#418 그대로) recoveryCurve · recoveryDayKeys · activityEndMs · parseHeartRateValues
  fill-recovery.ts     prisma: 청크 커서 → 날짜별 HeartRateRecord 1회 → recoveryCurve → update { hrr2, hrrDrop10 }
  __tests__/fill-recovery.test.ts   순수 부분 (청크의 일자 수집 · 결과 → update payload · 카운트) 만

src/lib/insights/
  types.ts             InsightRun.hrr2
  load.ts              select hrr2
  recovery.ts          recoveryPoints · recoveryByYear · recoveryDelta · yearFraction
  __tests__/recovery.test.ts

src/components/insights/
  scatter-format.ts    AxisFormat "year"
  InsightScatter.tsx   ScatterAxis.ticks?: number[]
src/app/insights/page.tsx   패널 E
```

**청크 알고리즘 (F2)**
1. `findMany` 러닝 200건 (`select id, startTime, duration, rawData`), 커서 `(startTime, id)`.
2. 각 활동 `endMs = activityEndMs(...)` · `keys = recoveryDayKeys(endMs)`. 청크의 고유 일자 → `heartRateRecord.findMany({ where: { date: { in } }, select: { date, rawData } })` → `Map<ymd, HrSample[]>`.
3. 활동별 `series = keys.flatMap(map.get)` · 종료일 행 없으면 `missing++`, 있으면 `recoveryCurve` → `hrr2 === null` 이면 `skipped++`, 아니면 `update({ hrr2, hrrDrop10 })`.
4. `dryRun` 은 3 의 update 만 생략.

**소수 연도 (F7)**: `yearFraction(ymd) = year + (dayOfYear − 1) / daysInYear` — KST ymd 문자열에서 계산 (`new Date(y, m, d)` 금지 → `Date.UTC`).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `prisma/schema.prisma` · `prisma/migrations/<ts>_activity_hrr/` | `hrr2` · `hrrDrop10` |
| `src/lib/heart/fill-recovery.ts` (+ 테스트) | 신규 |
| `src/lib/garmin/sync.ts` | 후처리 호출 |
| `scripts/backfill-hrr.ts` · `package.json` | 신규 스크립트 |
| `src/lib/insights/types.ts` · `load.ts` · `index.ts` · `recovery.ts` (+ 테스트) | `hrr2` · 패널 로직 |
| `src/components/insights/scatter-format.ts` · `InsightScatter.tsx` | `"year"` 포맷 · `ticks` |
| `src/app/insights/page.tsx` | 패널 E |
| `docs/designs/425-hrr-trend/` · `docs/specs/425-hrr-trend.md` · `docs/roadmap.md` · `docs/specs/M14-followup.md` | 시안 · 스펙 · #427 |

## 6. 테스트 계획

- `insights/recovery.test.ts`: 연도별 중앙값 (홀짝 · 5건 미만 null · years 열 유지) · delta (유효 해 2개 미만 null · 마지막 유효 해가 올해가 아닌 경우) · `yearFraction` (1월 1일 = year.0 · 12월 31일 < year+1 · 윤년)
- `fill-recovery.test.ts`: 순수 부분 — 청크 → 필요한 일자 집합 (자정 경계 활동은 2일) · 곡선 → payload (`hrr2` null 이면 skip · `hrrDrop10` 독립 null)
- `scatter-format.test.ts`: `"year"` 포맷
- 4종 검증 · 로컬: 마이그레이션 apply → `backfill:hrr --dry-run` → 실행 (러닝 5건) → `/insights` 패널 확인 (`localhost`)

## 7. 제외 사항 · 배포

- **배포 전 확인** (서버): 연도별 평균 샘플 수 — 하루 ~700 이면 2분 격자. 크게 다른 해가 있으면 그 해의 결측률을 foot 에 적는다 (백필 결과 `skipped` 로도 드러난다)
  ```bash
  psql "$DATABASE_URL" -Atc "select extract(year from date)::int, round(avg(jsonb_array_length(\"rawData\"->'heartRateValues'))), count(*) from \"HeartRateRecord\" where \"rawData\" ? 'heartRateValues' group by 1 order by 1;"
  ```
- **배포 후**: `npm run backfill:hrr` (러닝 2,157건 · HeartRateRecord ~2,100일 로드 · 1~2분 예상) → `pm2 restart` → `/insights` 패널 확인 · 활동 상세 곡선과 컬럼 값 일치 확인 1건
- 강도별 분리 (이지 · 인터벌) 패널 · `hrrDrop10` 의 별도 패널 — 후속 (컬럼은 이번에 채워 둔다)
- 러닝 외 활동의 HRR — 러닝 중심 원칙
