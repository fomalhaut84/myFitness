# [M16 #1] 러닝 종료 후 심박 회복 (HRR) — 활동 상세 회복 곡선

- **작성일**: 2026-09-23
- **타입**: feature
- **이슈**: #418
- **브랜치**: `feat/418-1`
- **의존**: 없음 (읽기 전용 · 스키마 변경 없음 · 패키지 추가 없음). 연도별 추이는 후속 이슈 (§7)

## 1. 배경

러닝을 마친 직후 심박이 얼마나 빨리 떨어지는지 (Heart Rate Recovery) 는 심폐 회복력의 대표 지표인데, 앱 어디에도 없다. Garmin 워치는 종료 후 1분 HRR 을 화면에 잠깐 보여 주고 끝이라 기록으로 남지 않는다.
DB 에는 이미 하루치 심박 시계열 (`HeartRateRecord.rawData.heartRateValues`, 약 2분 간격) 이 있고, 활동 시작 시각 · 길이도 있다. 둘을 겹치면 **API 호출 없이** 종료 후 회복 곡선을 만들 수 있다. 사용자 요청 (2026-09-22, #397 진행 중).

로컬 실측 (2026-09-23, 심박 7일 · 러닝 5건):

| 확인 | 결과 |
|---|---|
| 샘플 간격 | 하루 665~720개, 평균 125~128초 — **2분 격자** (`HH:MM:00`, 짝수 분) |
| 활동 중 반영 | 04-05 트랙 러닝 (21:51~22:44 KST, avgHR 123) 구간의 하루치 시계열은 121~128 → 활동 심박이 그대로 들어온다 |
| 종료 직후 | 종료 22:44:39 → `22:44=125 · 22:46=109 · 22:48=92 · 22:50=82 · 22:54=77`. **hrr2 = 16 bpm** |
| null 샘플 | 하루 0~2개 (`[epochMs, null]`) — 결측 처리가 실제로 필요 |
| `Activity.startTime` | UTC 인스턴트 (`rawData.startTimeGMT` 와 동일). `HeartRateRecord.date` 는 KST 자정 인스턴트 (`startOfDay`) |
| `rawData.elapsedDuration` | 5건 모두 존재. `duration` (타이머) 과 달리 일시정지를 포함한 벽시계 길이 |
| Garmin `recoveryTime` | 러닝 5건 전부 null → 이번 범위에서 제외 (프로덕션 확인은 이슈 쿼리) |

이슈 문구에서 달라지는 점 (재검증):

1. **종료 시각 = `startTime + elapsedDuration`** (rawData, 없으면 `duration`). 일시정지가 있는 러닝은 `duration` 만으로는 종료가 앞당겨져 회복 곡선이 활동 구간 안에 잡힌다.
2. 종료가 KST 자정 근처면 **앞뒤 날 레코드도 함께** 읽는다 — 종료 + 11분이 다음 날이면 다음 날, 종료 − 5분이 전날이면 전날 (사전 리뷰 major 1: 자정 직후 종료의 −4 · −2 분은 전날 시계열이다).
3. `/insights` 연도별 패널은 러닝 2,156건마다 하루치 시계열 (~15KB) 을 읽어야 해 페이지마다 계산할 수 없다 → `Activity.hrr2` 컬럼 승격 + 백필 이 필요하므로 **후속 이슈로 분리** (2026-09-23 승인).

## 2. 목표

1. 러닝 상세에서 **종료 후 10분의 심박 곡선과 2분 HRR** 을 본다. 데이터가 없으면 "기록 없음" 으로 정직하게.
2. 시계열 → 곡선 계산은 `src/lib/heart/recovery.ts` **순수 함수 + vitest**. 보간 없음, 2분 배수 오프셋만.
3. 해상도 한계 (2분) 를 UI 에 적는다 — 워치의 1분 HRR 과 같은 숫자가 아니다.

## 3. 요구사항

> **구현 (feat/418-1, 2026-09-23).** 순수 로직 vitest 14건 · 로컬 `next dev` 로 04-05 트랙 러닝 실화면 확인 (데스크톱 1040 · 폰 360, 가로 넘침 없음). 달라진 항목은 ↳.

**순수 로직 (`src/lib/heart/recovery.ts`)**
- [x] F1 `nearestSample(series, targetMs, toleranceMs)` — `[epochMs, bpm|null][]` 에서 목표 시각과 가장 가까운 샘플. 허용 오차 (±60초) 밖이거나 `bpm` 이 null · 0 이하면 `null`. 정렬을 가정하지 않는다 (하루 ~700개, 선형 탐색)
- [x] F2 `recoveryCurve(series, endMs)` → `{ endMs, points: { offsetMin, bpm, sampledAtMs }[], hrr2, drop10, postSamples }`. 오프셋은 **−4 · −2 · 0 · +2 · +4 · +6 · +10 분** (음수는 곡선의 맥락 — 달리던 심박). `hrr2 = bpm(0) − bpm(+2)`, 둘 중 하나라도 결측이면 `null`. `postSamples` = 종료 이후 (오프셋 ≥ 0) 유효 점 개수 — UI 의 "샘플 부족" 분기
- [x] F3 `parseHeartRateValues(raw)` — `rawData.heartRateValues` 검증 파서. 배열이 아니거나 원소가 `[number, number|null]` 꼴이 아니면 그 원소는 버린다 (memory: 필드 casing · 타입 없는 rawData 는 조용히 null 이 된다 — 여기서는 형태를 검사한다)
- [x] F4 `activityEndMs(startTime, durationSec, rawData)` — `rawData.elapsedDuration` 이 양수 유한값이면 그것, 아니면 `durationSec`

**서버 로딩 (`src/lib/heart/load-recovery.ts`, prisma)**
- [x] F5 `loadActivityRecovery(activityId)` — 활동 `startTime · duration · rawData` 조회 → 종료 시각 → `recoveryDayKeys` (종료 − 5분 · 종료 · 종료 + 11분 의 KST 일자, 1~2일) → `HeartRateRecord` `date in [...]` `select date, rawData` → 파싱 · 합치기 → `recoveryCurve`. **종료일** 행이 없으면 `{ hasRecord: false }` (앞뒤 날 행만 있는 경우는 없음으로)
- [x] F6 러닝 계열 (`isRunningType`) 만 호출. 페이지의 기존 select 는 건드리지 않고 별도 조회 1회 (rawData 를 클라이언트로 흘리지 않기 위해 분리)

**UI (`src/components/activity/RecoverySection.tsx`, 활동 상세 강도 분석 아래)**
- [x] F7 카드 제목 "종료 후 회복" + 작은 곡선 (x = 종료 기준 분, −4~+10 · y = bpm). 종료 시점 세로 점선, 결측 점은 끊긴 선 (`connectNulls=false`). 심박 색 `#f87171`
  - ↳ 결측 점은 자리를 비우지 않고 **점선 빈 원** (y 중앙 · 보조 계열 `missY`). 종료 전 점은 회색, 0 → +2 낙차 브래킷 `↓16` (시안 결정). Y 눈금은 10 단위 · 최대 5개 (`yScale`)
- [x] F8 판독값 2개: **2분 HRR** (`hrr2` bpm · 큰 숫자) · **10분 후** (`bpm(0) − bpm(10)`). 캡션에 종료 시각 (KST) 과 "2분 해상도 · 워치의 1분 HRR 과 다릅니다"
  - ↳ 라벨 "10분 낙차". 캡션은 원값 `125 → 109 bpm`. 종료 시각은 곡선의 세로 점선 라벨 (`종료 22:44`), 해상도 표기는 제목 오른쪽 `2분 해상도` + 각주
- [x] F9 빈 상태 3구분 — (a) 그 날 심박 레코드 없음 → "이 날 심박 기록이 없습니다" (b) 레코드는 있으나 유효 점 2개 미만 → "종료 후 샘플이 부족합니다 (워치 미착용?)" (c) 유효 점은 있으나 `hrr2` 결측 → 곡선은 그리고 숫자 자리에 "—"
- [x] F10 `hrr2` 가 음수면 (종료 후 심박이 오히려 오름) 부호 그대로 보이고 캡션 "종료 뒤에도 심박이 올랐어요 — 쿨다운 없이 멈췄거나 종료 시각이 어긋났을 수 있음"

**디자인 · 문서**
- [x] F11 시안 `docs/designs/418-hr-recovery/` (preview.html · design-notes.md · screenshots) — 활동 상세 카드 언어 그대로
- [ ] F12 `docs/specs/m15-overview.md` D8 표 · 로드맵은 PR 머지 후 문서 PR 에서

## 4. 기술 설계

```
page.tsx (server)
  ├─ prisma.activity.findUnique (기존 select)
  ├─ isRunningType ? loadActivityRecovery(id) : null        ← 신규 · 조회 2회 (activity rawData · heartRateRecord ×1~2)
  └─ <ActivityDetailClient activity recovery={dto} />
        └─ <RecoverySection recovery={dto} />               ← "use client" (Recharts LineChart)

src/lib/heart/
  recovery.ts        순수: nearestSample · recoveryCurve · parseHeartRateValues · activityEndMs · RECOVERY_OFFSETS_MIN
  load-recovery.ts   prisma: loadActivityRecovery → RecoveryDTO
  __tests__/recovery.test.ts
```

**DTO (서버 → 클라이언트, 직렬화 가능)**

```ts
interface RecoveryDTO {
  hasRecord: boolean;                 // 종료일 HeartRateRecord 존재
  endIso: string;                     // 종료 시각 (UTC ISO) — 클라이언트는 formatTimeKST
  points: { offsetMin: number; bpm: number | null }[];   // 7점 고정
  hrr2: number | null;
  drop10: number | null;              // bpm(0) − bpm(10)
  postSamples: number;                // 종료 이후 유효 점 개수
}
```

**시각 규칙**
- 종료 시각 `endMs = startTime.getTime() + activityEndMs(...) * 1000`.
- 오프셋 목표 `endMs + offsetMin * 60_000`, 허용 오차 `±60_000ms` (2분 격자에서 항상 한 샘플이 걸린다). 격자 두 샘플과 정확히 같은 거리면 앞쪽 (더 이른) 샘플.
- 날짜 경계: `ymdKST(end − 5min)` · `ymdKST(end)` · `ymdKST(end + 11min)` 의 고유 일자 (1~2일) 를 `kstInstant` 로 `date: { in: [...] }`.

**보간 · 리샘플 금지.** 워치 1분 HRR 을 흉내 내지 않는다 (PR #422 Codex P2).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/heart/recovery.ts` | 신규 · 순수 |
| `src/lib/heart/load-recovery.ts` | 신규 · prisma |
| `src/lib/heart/__tests__/recovery.test.ts` | 신규 · vitest |
| `src/components/activity/RecoverySection.tsx` | 신규 · 클라이언트 |
| `src/app/activities/[id]/page.tsx` | `loadActivityRecovery` 호출 + prop |
| `src/app/activities/[id]/activity-detail-client.tsx` | `recovery` prop → `<RecoverySection>` (강도 분석 아래) |
| `docs/designs/418-hr-recovery/` | 시안 |
| `docs/specs/418-hr-recovery.md` | 이 문서 |

## 6. 테스트 계획

vitest `recovery.test.ts` (실측 04-05 시계열을 픽스처로):
- 실측 케이스: 종료 22:44:39 → `bpm(0)=125 · (+2)=109 · (+4)=92 · (+6)=82 · (+10)=77 · hrr2=16 · drop10=48`
- 허용 오차: 목표에서 61초 떨어진 샘플만 있으면 결측 · 60초면 채택 · 동거리면 이른 쪽
- null 샘플: 오프셋 자리가 `[ms, null]` 이면 그 점 결측, `hrr2` 는 0 · +2 중 하나라도 결측이면 null
- 워치 벗음: 종료 후 전부 null → `postSamples = 0` 으로 UI 분기 (b)
- `parseHeartRateValues`: 배열 아님 · 원소 형태 불량 · 문자열 bpm 은 버림
- `activityEndMs`: elapsedDuration 우선 · 0 · 음수 · 문자열 · 없음 → duration
- 자정 경계: 두 날의 시계열을 합쳐 +10 분이 다음 날 샘플에서 잡힘 · **자정 직후 종료 (00:02) 의 −4 · −2 · 0 분이 전날 샘플에서 잡힘** (회귀: 사전 리뷰 major 1) — 순수 함수는 합친 배열을 받고, 로더 분기는 `recoveryDayKeys` 로 확인

4종 검증 + 로컬 `next dev` 로 04-05 트랙 러닝 상세 실화면 확인 (localhost — memory `project_next_dev_localhost_origin`).

## 7. 제외 사항

- **`/insights` 연도별 HRR 패널** — `Activity.hrr2` 컬럼 승격 (`prisma-drift-fix`) + `backfill:hrr` 스크립트 (API 호출 0 · HeartRateRecord 만 읽음) + 패널. 후속 이슈로 (이 PR 의 순수 함수를 그대로 재사용).
- Garmin `recoveryTime` 보조 표기 — 로컬 전부 null. 프로덕션에 있으면 후속에서.
- 활동 상세 엔드포인트 (초 단위) 로 1분 HRR 만들기 — 활동 구간만 담아 종료 후를 못 본다.
- 러닝 외 활동 — 사이클 · 걷기 도 같은 계산이 되지만 러닝 중심 원칙에 따라 이번엔 러닝만.
- 배포 후 확인: 이슈의 프로덕션 쿼리 2개 (`heartRateValues` 시작일 · `recoveryTime` 존재) — 시작일 이전 활동은 (a) "기록 없음" 으로 보인다.
