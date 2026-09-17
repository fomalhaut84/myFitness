# Garmin VO2max · 러닝 젖산역치 이력 싱크 — `fitness_metrics` dataType

- **작성일**: 2026-09-17
- **이슈**: #378
- **선행**: #377 (MCP 장기 조회 — 집계 유틸 `aggregate.ts` · backfill 스크립트 재사용)
- **범위**: 신규 Garmin dataType + Prisma 모델 + 수동 SQL 마이그레이션 + MCP 도구 1개. 웹 UI 제외.

## 1. 배경

`get_metric_history` 는 `MetricChange` (앱이 프로필 스냅샷 변화를 기록한 로그) 만 보므로 VO2max 는 2026-04-27, LTHR 은 앱 도입 이후만 있다. Garmin Connect 성과통계에는 훨씬 긴 이력이 있고 엔드포인트도 실측됐다 (#377 스펙 §1-3, 2026-09-17 로컬 probe):

| 지표 | 엔드포인트 | 응답 | 실측 |
|---|---|---|---|
| VO2max 일별 | `GET /metrics-service/metrics/maxmet/daily/{start}/{end}` | `[{ generic: { calendarDate, vo2MaxPreciseValue, vo2MaxValue, fitnessAge }, cycling, heatAltitudeAcclimation }]` | 2020-06-26 부터 · 거의 매일 1 row · 367일 범위 허용 · 연간 ~250KB |
| 젖산역치 HR | `GET /biometric-service/stats/lactateThresholdHeartRate/range/{start}/{end}?sport=RUNNING&aggregation=daily` | `[{ from, until, series: "running", value, updatedDate }]` bpm | 2023-05-26 부터 · 감지일만 (연 5~8 row) · **366일 초과 시 400** |
| 젖산역치 속도 | `.../stats/lactateThresholdSpeed/range/...` 동일 | `value` × 10 = m/s (user-profile 규칙과 동일) | 동상 |

## 2. 목표

"컨디션이 제일 좋았던 시기의 VO2max · 젖산역치" 류 질문에 Garmin 보유 전 기간(2020-06~)으로 답한다.

## 3. 요구사항

- [ ] **F1 모델** `FitnessMetricDaily { id, date @unique, vo2maxRunning Float?, lthr Int?, lthrPace Float? /* sec/km */, fitnessAge Int?, rawData Json?, createdAt }`. 어느 한 값이라도 있는 날짜만 row. 수동 SQL 마이그레이션 (`prisma-drift-fix` 절차, `migrate reset` 금지).
- [ ] **F2 fetcher** `src/lib/garmin/fetchers/fitness-metrics.ts` `syncFitnessMetrics(client, start, end)`: 범위를 **365일 청크로 내부 분할** 후 청크마다 3회 호출 (maxmet · LT HR · LT speed, 각 `withRateLimit`). 날짜 키로 병합해 `date @unique` upsert. `lthrPace = 1000 / (value × 10)`. `calendarDate`/`from` 은 `YYYY-MM-DD` 문자열 → KST 자정 instant (`T00:00:00+09:00`), #364 규칙. 404/빈 배열은 0건.
- [ ] **F3 sync 등록** `DataType` 에 `"fitness_metrics"` 추가, `SYNC_FNS` · `SYNC_ORDER` (user_profile 앞) · `/api/sync` `VALID_DATA_TYPES` · `firstRecordDate` finders. cron 은 `bootstrapNewTypes: true` 라 배포 후 첫 실행에서 365일 자동 로드. 더 과거는 #377 의 `backfill:history -- --types=fitness_metrics --from=2020-06-01`.
- [ ] **F4 MCP 도구** `get_fitness_metric_trend({ days?, granularity? })` 신설: `FitnessMetricDaily` 를 #377 `aggregate.ts` 로 집계 (`vo2maxRunning` avg/max, `lthr` · `lthrPace` 는 **감지일 값 그대로 + 구간 내 최신값**), 응답에 `current` (최신 row), `best` (VO2max 최고 날짜·값, lthrPace 최저 날짜·값), `_context` 에 "LT 는 Garmin 이 감지한 날만 기록되므로 빈 구간은 직전 값 유지" 명시. `get_metric_history` description 에 "Garmin 장기 이력은 get_fitness_metric_trend" 안내 추가.
- [ ] **F5 프로필 연동 점검**: `user-profile.ts` 의 VO2max/LTHR 스냅샷 로직은 **변경하지 않는다** (source 보호 규칙 유지). 두 소스가 다를 때 AI 가 혼동하지 않도록 F4 응답의 `current` 에 `asOf` 날짜를 넣는다.
- [ ] **F6 회귀 검증** `scripts/verify-fitness-metrics-parse.ts`: probe 응답 fixture 로 파서 검증 (속도→페이스 변환 · 날짜 KST · 희소 LT 병합 · 청크 분할 경계 366일). `npm test` 체인 추가.

## 4. 기술 설계

### 4.1 변경 파일

| 파일 | 변경 |
|---|---|
| `prisma/schema.prisma` · `prisma/migrations/<ts>_add_fitness_metric_daily/migration.sql` | F1 |
| `src/lib/garmin/fetchers/fitness-metrics.ts` | F2 신설 |
| `src/lib/garmin/sync.ts` · `src/app/api/sync/route.ts` | F3 |
| `src/mcp/tools/fitness-metrics.ts` · `src/mcp/server.ts` · `src/lib/ai/system-prompt.ts` | F4 |
| `scripts/verify-fitness-metrics-parse.ts` · `package.json` | F6 |

### 4.2 호출량

VO2max 는 연 1회 호출로 365 row. LT 는 연 2회 호출. 7년 backfill 도 호출 21회 × 2초 ≈ 1분. 일별 엔드포인트가 아니라 부담 없음.

### 4.3 데이터 정합성

- `fitnessAge` 는 2023 이후 null 인 날이 많음 (실측) — nullable.
- LT `aggregation=daily` 의 `from == until` 이라 `from` 을 날짜 키로 쓴다.
- 같은 날 VO2max 와 LT 가 겹치면 한 row 에 병합 (upsert 는 필드별 `undefined` 로 기존 값 보존).

## 5. 테스트 계획

- 4종 검증 + F6.
- 로컬: `npx tsx scripts/sync-garmin.ts` 대신 `/api/sync {dataTypes:["fitness_metrics"], startDate:"2025-09-17"}` 로 1년치 → psql count 확인.
- 배포 후: cron 첫 실행 로그 `[fitness_metrics] 싱크 시작: 2025-09-… ~` 확인 → backfill `--types=fitness_metrics --from=2020-06-01` → `/ai` 로 "VO2max 가 가장 높았던 때" 질문.

## 6. 제외 사항

- 웹 UI 차트 (후속).
- 사이클링 VO2max · `heatAltitudeAcclimation` (rawData 에만 보존).
- 레이스 예측 · 지구력/힐 점수 · 트레이닝 상태 이력 — #377 착수 전 외부 프로젝트 분석 결과에 따라 별도 이슈.
