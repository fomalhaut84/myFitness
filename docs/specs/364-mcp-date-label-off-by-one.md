# get_weight_loss_status 날짜 라벨 off-by-one — UTC 절단으로 하루 밀림

- **작성일**: 2026-09-04
- **타입**: fix
- **이슈**: #364

## 1. 배경

2026-09-04 모닝 리포트가 **"어제(09-03) intake 데이터 없음"** 으로 나왔으나, 실제로는 09-03 식단 3건(2151kcal)이 정상 기록돼 있었다.

사용자가 AI 어드바이저에 되물었을 때, AI 는 같은 `get_weight_loss_status` 응답 안에서 09-03 이 두 값으로 나온다고 보고했다.

| 필드 | 09-03 값 |
|---|---|
| `calorieSummary.dailyBalances` | `intake: null`, `balance: null` |
| `macroSummary.daily` | `kcal: 2151`, `proteinG: 74.2`, `missingCount: 0` |

### DB 검증 결과 — 데이터는 정상

```
DailySummary (저장된 naive timestamp)
  2026-09-02 15:00  → KST 09-03 : intake 2151, available 2663, balance -512
  2026-09-03 15:00  → KST 09-04 : intake null,  available 1923  (오늘, 식사 전 — 정상)

FoodLog (09-03 KST 창): 3건, estimatedKcal NULL 0건, 합계 2151
stale-recalc 큐: 0건
```

**09-03 밸런스는 `-512` 로 정확히 저장돼 있었다.** 집계 로직·재계산 파이프라인·큐 모두 정상.

### 원인

`src/mcp/tools/weight-loss.ts:308`

```js
date: b.date.toISOString().slice(0, 10),
```

`DailySummary.date` 는 **KST 자정의 UTC instant** 다 (KST 09-03 → `2026-09-02T15:00:00Z`). `toISOString()` 은 UTC 기준으로 문자열화하므로 `.slice(0,10)` 이 `"2026-09-02"` 를 내놓는다 → **모든 행의 라벨이 하루씩 앞으로 밀린다.**

| 응답 라벨 | 실제 KST 일자 | intake |
|---|---|---|
| `"2026-09-02"` | 09-03 | 2151 |
| `"2026-09-03"` | 09-04 (오늘) | null |

AI 가 `dailyBalances` 에서 `"2026-09-03"` 을 찾으면 **오늘 행(null)** 을 집는다. 반면 `macroSummary.daily` 는 `aggregateDailyMacros` 가 `ymdKST()` 를 쓰므로 정확하다 — **같은 응답 안에서 두 날짜가 어긋난 이유가 정확히 이것.**

`DailySummary.date` 가 KST 자정 instant 라는 점은 `calorie-balance.ts` 의 `kstDayBoundary()` 가 보장한다 (`summaryKey = new Date(\`${ymd}T00:00:00+09:00\`)`).

### 동일 패턴 2곳

| 위치 | 영향 | 심각도 |
|---|---|---|
| `weight-loss.ts:308` | `dailyBalances[].date` — 위 본문 | **P2** |
| `weight-loss.ts:337` | `byIntensity[].date` (`a.startTime`) — **09:00 KST 이전 운동이 전날로 라벨링**. 아침 러닝 위주 사용자라 상시 영향 | **P2** |
| `cron.ts:70` | stale-recalc 성공 로그의 `key` — 로그 전용이나 장애 진단 시 오독 유발 | **P0** |

### 오탐 배제 (수정 대상 아님)

| 위치 | 판단 |
|---|---|
| `src/mcp/logger.ts:45` | `new Date(Date.now() + 9h)` 로 **의도적 선반영** 후 절단. 주석에 근거 명시. 정상 |
| `src/lib/weather/open-meteo.ts:70` | Open-Meteo `start_date`/`end_date` 는 `hourKeyUtc()` 의 UTC hourly 계열과 매칭. UTC 로 일관 — 정상 |
| 그 외 `src/mcp/**` 의 `toISOString()` | 전부 **전체 ISO 문자열** (오프셋 보존). 절단하지 않으므로 안전 |

### 영향 범위 — 라벨만 틀렸다

`avgDailyBalance` · `consecutiveDeficitDays` · `muscleLossRisk` 는 `calorieBalance` 가 non-null 인 행만 사용하며 09-03(-512)은 정상 포함됐다. `daysWithData: 6` 도 오늘(미완료일)이 빠진 정상 동작이다.

**AI 가 "결손 평균 628kcal 이 09-03 누락으로 오염됐다" 고 한 것은 오진**이다. 수치는 정확했고, 틀린 것은 라벨뿐이다. 다만 그 라벨 때문에 리포트가 "어제 식단 없음"이라고 **단언**한 것이 실제 피해다.

## 2. 목표

MCP 응답의 날짜 라벨을 **KST 기준**으로 통일해, AI 가 날짜로 조인할 때 어긋나지 않게 한다.

## 3. 요구사항

- [ ] F1: `dailyBalances[].date` 를 `ymdKST()` 로 산출
- [ ] F2: `byIntensity[].date` 를 `ymdKST()` 로 산출
- [ ] F3: `cron.ts` stale-recalc 로그 key 를 `ymdKST()` 로 산출
- [ ] F4: 회귀 검증 스크립트 추가 — KST 자정 instant · 09:00 KST 이전 시각에서 라벨이 밀리지 않음

## 4. 기술 설계

`weight-loss.ts` 는 이미 `ymdKST` 를 import 중 (`kstMidnightUTC` 에서 사용). 추가 import 불필요.

```diff
- date: b.date.toISOString().slice(0, 10),
+ date: ymdKST(b.date),
```

`ymdKST` 는 `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })` 기반이라 서버 TZ 와 무관하게 정확하다 (`src/lib/garmin/utils.ts:39`).

`cron.ts` 는 `ymdKST` import 추가.

### 4.1 회귀 검증 (F4)

`scripts/test-mcp-date-labels.ts` — 프로젝트에 테스트 프레임워크가 없어 `workflow.md` 8-5 에 따라 스크립트로 대체. DB 없이 순수 함수만 검증.

경계 케이스:
- KST 자정 instant (`2026-09-02T15:00:00Z`) → `"2026-09-03"`
- KST 00:00~09:00 구간 활동 (`2026-09-02T22:00:00Z` = KST 09-03 07:00) → `"2026-09-03"`
- KST 23:59 (`2026-09-03T14:59:00Z`) → `"2026-09-03"`
- 각 케이스에 대해 **구 구현(`toISOString().slice(0,10)`)이 실제로 하루 밀렸음**을 함께 단언 — 버그 재발 시 즉시 드러나도록

## 5. 테스트 계획

- `npx tsx scripts/test-mcp-date-labels.ts`
- `npm run lint && npm run typecheck && npm run build`
- 배포 후 다음 모닝 리포트에서 어제 intake 가 정상 표기되는지 확인

## 6. 제외 사항

- `weights` (`daysAgo` 기반 14일 창) 의 시맨틱 정리 — 라벨 버그와 별개, 기존 코드 유지
- 테스트 프레임워크 도입 — 백로그 D-3
- `macroSummary` — 이미 `ymdKST` 사용, 수정 불필요
