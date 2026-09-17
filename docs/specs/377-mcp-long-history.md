# MCP 장기 조회 — 365일 상한 해제 · 집계 granularity · 보유 범위 노출 · 과거 backfill

- **작성일**: 2026-09-17
- **이슈**: #377
- **범위**: MCP 도구 스키마/핸들러 (`src/mcp/**`) + 시스템 프롬프트 + backfill 스크립트 + 회귀 검증 스크립트. DB 스키마 변경 없음.
- **후속 (별도 이슈)**: Garmin VO2max · 러닝 젖산역치 **이력** 싱크 (§6 참조)

## 1. 배경

2026-09-16 `/ai` 질문:

> 가민에 저장된 전체 기록에서 체중과 러닝기록을 비교해보고 신체 컨디션이 제일 좋았던때의 시기와 그 당시 체중, 10km 하프 러닝 기록과 vo2max 러닝젖산역치를 알려주고 현재와 어떻게 다른지 비교해줘

AI 는 "도구가 최대 365일로 제한돼 2025-09-16 이전은 조회 불가" 로 답했다. 원인은 두 겹이고 AI 답변은 첫 겹만 설명한 것이다.

### 1-1. MCP 도구 스키마 상한 (코드)

| 위치 | 내용 |
|---|---|
| `src/mcp/server.ts` `days` 파라미터 8곳 | `z.number().int().positive().max(365)` |
| `src/mcp/tools/pace-progression.ts:66` | `Math.min(365, Math.max(30, args.windowDays ?? 90))` |
| `src/mcp/tools/race-prediction.ts:110` | 동일 clamp |
| `src/mcp/tools/user-profile.ts` `getMetricHistory` | 스키마 `max(365)` |

DB 에 더 오래된 데이터가 있어도 AI 는 못 본다.

### 1-2. DB 보유 범위 (데이터)

`src/lib/garmin/sync.ts:20` `INITIAL_HISTORY_DAYS = 365`. 초기 싱크가 2026-04 이라 프로덕션 DB 실보유 범위는 (2026-09-17 서버 psql 확인):

| 항목 | 값 |
|---|---|
| `Activity` 최초 | **2025-04-01** (528건) |
| `BodyComposition` 최초 | 2025-06-18 (47건 · 체중계 첫 기록으로 추정) |
| `SyncMetadata.oldestFetchedDate` (전 타입) | **2026-04-21** ← 실데이터(2025-04-01)와 불일치 |
| `SyncMetadata.coveredThroughDate` | 2026-09-17 |

즉 1-1 만 풀면 2025-04 ~ 2025-09 의 약 5개월이 추가로 보이고, 그 이전은 Garmin 에서 가져온 적이 없다. Garmin Connect 원본은 **2019-06 부터** 존재 (사용자 확인).

`oldestFetchedDate` 불일치는 #220 마이그레이션 시점에 짧은 싱크로 seed 된 흔적이다. backfill 이 인접 구간으로 병합되며 자연 교정된다 (§4.5).

### 1-3. 프로필 메트릭 이력의 한계 (이번 범위 밖 · 사실 기록)

AI 가 말한 "VO2max 는 2026-04-27 부터 기록" 은 `get_metric_history` 가 **앱이 프로필 스냅샷을 찍기 시작한 시점**부터만 `MetricHistory` 를 갖기 때문이다. Garmin 에는 이력이 있고 엔드포인트도 확인됐다 (2026-09-17 로컬 probe):

| 지표 | 엔드포인트 | 실측 |
|---|---|---|
| VO2max 일별 | `GET /metrics-service/metrics/maxmet/daily/{start}/{end}` → `[].generic.vo2MaxPreciseValue` | 2020-06-26 부터 · 367일 범위도 허용 · 연간 ~250KB |
| 젖산역치 HR | `GET /biometric-service/stats/lactateThresholdHeartRate/range/{start}/{end}?sport=RUNNING&aggregation=daily\|monthly` → `[].value` (bpm) | 2023-05-26 부터 · **범위 366일 초과 시 400** · 감지 이벤트일만 (희소) |
| 젖산역치 속도 | `.../stats/lactateThresholdSpeed/range/...` → `[].value` (×10 = m/s, 기존 user-profile 규칙과 동일) | 동상 |
| 최신값 | `GET /biometric-service/biometric/latestLactateThreshold` | speed·hearRate 두 row (오타 `hearRate` 가 실제 키) |

→ 별도 이슈로 분리 (§6). 이 스펙은 **이미 DB 에 있는/들어올 데이터를 AI 가 쓸 수 있게** 하는 데 집중한다.

### 1-4. 참고: 외부 Garmin MCP 와의 차이

`Taxuspt/garmin_mcp` (Python · 110+ 도구) · `Nicolasvegam/garmin-connect-mcp` (TS · 61 도구) 는 둘 다 **DB 없이 매 요청 Garmin API 를 라이브 호출**하는 passthrough 라 365일 문제 자체가 없다. 대신 파생 분석(ACWR · readiness · 부상 위험 · 페이스 진척 · 트레이닝 플랜) 이 없고, 매 질문이 Garmin rate limit 에 노출된다. myFitness 는 DB 캐시 + 파생 분석 구조를 유지하고, 라이브 passthrough 는 도입하지 않는다 — 장기 조회는 **DB 를 채우고(backfill) 집계로 응답 크기를 제어**하는 쪽으로 푼다.

## 2. 목표

1. AI 가 DB 에 있는 **모든 기간**을 조회할 수 있다.
2. 장기 조회 응답이 컨텍스트를 터뜨리지 않는다 (주/월 집계).
3. AI 가 "도구 한도" 가 아니라 **실제 보유 범위**를 근거로 답한다.
4. Garmin 원본 2019-06 까지 backfill 할 수 있는 운영 절차가 있다.

## 3. 요구사항

- [ ] **F1 상한 상수화**: `src/mcp/tools/constants.ts` 에 `MAX_QUERY_DAYS = 3650` (10년). `server.ts` 의 `days`/`windowDays` 스키마 `max(365)` 전부 → `max(MAX_QUERY_DAYS)`. `pace-progression.ts` · `race-prediction.ts` 핸들러 clamp 도 상수 사용. `get_calendar_summary` 의 90 은 유지 (일자별 한 줄 도구라 목적이 다름 — description 에 명시).
- [ ] **F2 집계 granularity**: `get_activities` · `get_sleep` · `get_heart_rate` · `get_daily_stats` · `get_body_composition` 에 `granularity?: "daily" | "weekly" | "monthly"` 추가.
  - 생략 시 자동: `days ≤ 120` → daily, `≤ 730` → weekly, 그 외 monthly. 명시하면 그대로 — 단 **daily 결과가 `MAX_DAILY_ROWS = 400` 행을 넘으면 weekly(≤730일)/monthly 로 자동 승격**하고 `_context.promoted` 로 알린다 (사전 리뷰 M2: 명시 daily + days 3650 이면 수천 행이 컨텍스트에 실림. 잘라내기는 과거 구간이 조용히 사라져 오답 유발이라 채택 안 함).
  - 응답을 `{ granularity, from, to, days, count, records: [...], _context? }` 로 감싼다 (daily 도 동일 envelope — AI 가 항상 같은 형태를 본다). 기존 `get_sleep`/`get_daily_stats` 의 `records` 키를 그대로 쓰고, 배열만 돌려주던 도구도 같은 envelope 로 통일. 기존 레코드 필드는 유지.
  - 집계 규칙 (`src/mcp/tools/aggregate.ts`, 순수 함수 · 불변):
    - 버킷 라벨은 **KST** 기준. weekly = ISO 주 (월요일 시작) `YYYY-Www` + `weekStart`(그 주 월요일; `from` 은 실제 첫 레코드 날짜), monthly = `YYYY-MM`.
    - 숫자 필드는 null 제외 평균, 소수 1자리. `count` (레코드 수) 포함.
    - 체중: `avg` 외에 `min`/`max` 추가 (컨디션 최고 시기 탐색용).
    - 활동: 버킷 × activityType 별 `{ count, totalDistanceKm, totalDurationMin, avgPace (거리 가중: 총시간/총거리), avgHR (시간 가중), longestKm, avgVo2maxEstimate }`. `type` 필터는 그대로 적용.
    - 수면/심박/일일: 시각 필드(`sleepStart/End`) 와 문자열 필드는 집계에서 제외.
- [ ] **F3 `get_data_coverage` 도구 신설**: 인자 없음. dataType 별 `{ oldest, newest, count }` 를 **실제 레코드**(`firstRecordDate` 와 동일 기준) 로 반환 + `SyncMetadata` 커버 범위(`oldestFetchedDate`/`coveredThroughDate`) 병기 + 러닝 활동은 별도 count. 날짜 라벨 KST (#364 규칙). MCP 번들이 `garmin-connect` 를 끌어오지 않도록 `sync.ts` 를 import 하지 않고 prisma aggregate 로 직접 조회.
- [ ] **F4 시스템 프롬프트**: "전체 기록 / 역대 / 가장 좋았던 때 / N년 전" 류 질문은 ① `get_data_coverage` 로 범위 확인 → ② `days` 를 그 범위로 설정 → ③ 장기면 `granularity` 로 집계 조회 후 필요한 구간만 daily 로 재조회, 순서를 명시. 도구 description 에 상한(`최대 3650`) 과 granularity 자동 규칙을 적는다. "도구 한도" 라는 표현 대신 "보유 범위 밖" 으로 답하도록 지시.
- [ ] **F5 backfill 스크립트** `scripts/backfill-history.ts` (npm `backfill:history`): `--from=YYYY-MM-DD` 필수, `--to=` 생략 시 현재 `oldestFetchedDate - 1일` (없으면 어제), `--types=` 생략 시 user_profile 제외 전 타입. **최신 → 과거** 순으로 365일 청크 (LT 엔드포인트 366일 제한과 동일 여유 · 기존 초기 싱크 검증 범위) 로 `syncAll({ startDate, endDate, dataTypes })` 호출. 청크 실패 시 1회 재시도 후 다음 청크 진행, 종료 시 실패 청크 목록 출력. 진행 로그에 청크 번호/범위/소요 시간.
- [ ] **F6 회귀 검증** `scripts/verify-mcp-long-history.ts` (npm test 에 추가): ① `aggregate.ts` fixture 검증 (주 경계 KST · 월 경계 · null 제외 · 거리 가중 페이스) ② `src/mcp/**` 소스 스캔 — `.max(365)` 리터럴 0건, `Math.min(365` 0건 (상수 우회 방지) ③ auto granularity 경계값 (120/121, 730/731) ④ backfill 청크 순서·인접·경계.

## 4. 기술 설계

### 4.1 변경 파일

| 파일 | 변경 |
|---|---|
| `src/mcp/tools/constants.ts` | 신설 — `MAX_QUERY_DAYS`, `AUTO_WEEKLY_THRESHOLD_DAYS = 120`, `AUTO_MONTHLY_THRESHOLD_DAYS = 730` |
| `src/mcp/tools/aggregate.ts` | 신설 — `bucketKeyKST(date, granularity)`, `resolveGranularity(days, explicit?)`, `aggregateDaily(rows, fields)`, `aggregateActivities(rows)` |
| `src/mcp/tools/fitness.ts` | 5개 핸들러에 granularity 적용 + envelope |
| `src/mcp/tools/coverage.ts` | 신설 — `getDataCoverage()` |
| `src/mcp/tools/pace-progression.ts` · `race-prediction.ts` | clamp 상수화 |
| `src/mcp/server.ts` | 스키마 상한 상수화 · granularity 파라미터 · `get_data_coverage` 등록 · description 갱신 |
| `src/lib/ai/system-prompt.ts` | F4 가이드 |
| `scripts/backfill-history.ts` · `scripts/verify-mcp-long-history.ts` | 신설 |
| `package.json` | `backfill:history`, `verify:mcp-long-history` (test 체인에 추가) |
| `src/lib/garmin/backfill-chunks.ts` | 신설 — `buildBackfillChunks` (순수 함수, 최신→과거 365일 청크) |

### 4.2 집계 함수 시그니처

```ts
type Granularity = "daily" | "weekly" | "monthly";
function resolveGranularity(days: number, explicit?: Granularity): Granularity;
function bucketKeyKST(date: Date, g: Granularity): string;         // "2025-W14" | "2025-04" | "2025-04-01"
function aggregateDaily<T extends { date: Date }>(rows: readonly T[], numericFields: readonly (keyof T)[], g: Granularity, extra?: { minMax?: readonly (keyof T)[] }): AggRow[];
function aggregateActivities(rows: readonly ActivityRow[], g: Granularity): ActivityAggRow[];
```

모두 입력을 변경하지 않는 순수 함수. `daily` 는 집계 없이 envelope 만 씌운다.

### 4.3 응답 envelope

```json
{ "granularity": "monthly", "from": "2025-04-01", "to": "2026-09-17", "days": 535, "count": 18,
  "records": [ { "bucket": "2025-04", "from": "2025-04-01", "to": "2025-04-29", "count": 12, "weight": { "avg": 86.4, "min": 85.9, "max": 87.1 }, "bmi": 27.1 } ] }
```

### 4.4 `get_data_coverage` 응답

```json
{ "asOf": "2026-09-17", "types": { "activities": { "oldest": "2025-04-01", "newest": "2026-09-16", "count": 528, "runningCount": 410 }, "body_composition": { ... } },
  "syncCoverage": { "activities": { "oldestFetched": "2026-04-21", "coveredThrough": "2026-09-17" } },
  "note": "oldest 가 실제 조회 가능 하한. 그 이전은 Garmin 에서 아직 가져오지 않은 구간." }
```

### 4.5 backfill 과 SyncMetadata 병합 (#220 규칙)

`updateSyncMetadata` 는 새 range 가 기존 `[oldestFetchedDate, coveredThroughDate]` 와 **인접/중첩일 때만 병합**하고, disjoint + 과거는 무시한다. 따라서:

- 청크를 **최신 → 과거** 순으로 돌린다. 첫 청크 `endDate = oldestFetchedDate - 1` 이 인접 → `oldestFetchedDate` 가 청크 시작으로 당겨지고, 다음 청크가 다시 인접이 된다.
- 현재 `oldestFetchedDate = 2026-04-21` 이므로 첫 청크는 `2025-04-21 ~ 2026-04-20`. 이 구간은 데이터가 이미 있어 upsert 로 덮어써진다 (**중복 없음**, 1년치 API 재호출 비용 ≈ 40분 감수). 이로써 1-2 의 메타데이터 불일치도 교정된다.
- 과거 → 최신 순으로 돌리면 마지막 청크만 병합돼 `oldestFetchedDate` 가 잘못 남는다. 스크립트가 순서를 강제한다.
- **`lastSyncDate` 는 backfill 대상이 아니다** (사전 리뷰 C1). `updateSyncMetadata` 는 `lastSyncDate = endDate` 를 무조건 덮어쓰므로 최신→과거 backfill 이 끝나면 가장 오래된 청크의 end(2020년대) 로 남고, weekly-report 의 startDate 없는 `syncAll` 이 `lastSyncDate + 1` 부터 수년치를 재싱크한다 (약 11시간, 실패 시 매주 반복). 스크립트가 실행 전 타입별 스냅샷을 찍고 **매 청크 직후** 복원한다 (그 사이 cron 이 더 늦은 값을 썼으면 유지 — `updateMany where lastSyncDate < restored` 조건부 갱신).
- `--to` 기본값은 선택 타입들의 `oldestFetchedDate` 중 **가장 늦은 값 − 1일** (사전 리뷰 M1). 병합 조건이 `endDate >= oldestFetchedDate − 1` 이라 늦은 마커 기준이어야 모든 타입에서 첫 청크가 인접/중첩이 된다. 이른 마커를 가진 타입은 중첩 → `LEAST` 병합이라 무해.

### 4.6 소요 시간 추정

일별 엔드포인트 3종 (daily_stats · sleep · heart_rate) × 2초 딜레이 × 365일 ≈ **37분/년**. 활동·체중·혈압은 범위 조회라 분 단위. 2019-06 ~ 2026-04 ≈ 7년 → **약 4.5시간**. 서버에서 `nohup npm run backfill:history -- --from=2019-06-01 > backfill.log &` 로 실행. 06:00 cron 과 겹쳐도 date-unique upsert 라 충돌 없음 (메타데이터는 atomic UPDATE). 청크 단위라 중단 시 `--to=` 로 이어서 재개 가능.

### 4.7 컨텍스트 크기 가늠

월간 집계 시 7년 = 84 row × ~15 필드 ≈ 10KB. 주간 집계 2년 = 104 row. daily 120일 = 현재와 동일 수준. `get_activities` 는 type 별 분리라 러닝만 필터 시 84 row.

## 5. 테스트 계획

- 4종 검증: `npm run lint && npm run typecheck && npm run test && npm run build`
- F6 스크립트가 `npm test` 체인에 포함.
- 수동: 로컬 MCP `tools/list` 로 `get_data_coverage` 노출 확인 · `get_body_composition {days: 600}` 이 monthly envelope 반환 · `{days: 600, granularity: "daily"}` 시 daily.
- 배포 후: backfill 1청크(`--from=2025-04-21 --to=2026-04-20`) 로 병합 동작 확인 → `SyncMetadata.oldestFetchedDate` 가 2025-04-21 로 바뀌는지 psql 확인 → 전체 `--from=2019-06-01` 실행.
- 실사용: 1절 프롬프트 재실행 → 2025-04 이후 전체 + backfill 후 2019-06 이후로 답변 범위 확장 확인.

## 6. 제외 사항 (후속 이슈)

- **VO2max · 젖산역치 Garmin 이력 싱크** — 신규 dataType (`fitness_metrics`) + 모델 + 마이그레이션 + `get_metric_history` 확장. 1-3 의 엔드포인트 실측을 그대로 쓴다. 별도 이슈.
- 웹 UI 차트의 장기 범위 (이번은 MCP/AI 경로만).
- `get_calendar_summary` 상한 (목적상 90일 유지).
- `fitness.ts` `daysAgo` 의 서버 로컬 TZ 의존 — #365 범위.
- Garmin 2019-06 이전 (원본 없음).
- 라이브 Garmin passthrough 도구 (1-4 결정).
