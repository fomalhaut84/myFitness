# 수면 SpO2 파싱 키 오타 fix + 최저/최고 SpO2 저장

- **작성일**: 2026-08-27
- **타입**: fix
- **이슈**: #338
- **우선순위**: P1

## 1. 배경

모닝 리포트의 "수면 분석" 섹션에서 SpO2 가 항상 `측정값 없음(null)` 으로 출력됨.
사용자가 Garmin Connect 앱에서는 수면 중 SpO2 그래프가 정상 표시되는 것을 관찰하고 제보.

원인 조사 결과, Garmin 응답에는 SpO2 가 정상적으로 포함되어 있으나 **파싱 키 이름이 실제 API 필드와 다름**.

`src/lib/garmin/fetchers/sleep.ts:74-77`
```ts
avgSpO2: toFloat(
  (sleepData as unknown as Record<string, unknown>).averageSpo2 ??   // 존재하지 않는 키
  (dto as unknown as Record<string, unknown>).averageSpo2            // 존재하지 않는 키
),
```

실제 `dailySleepDTO` 필드는 **`averageSpO2Value`** (대문자 `SpO2` + `Value` 접미사).

### 근거 (로컬 DB `SleepRecord.rawData` 검증)

| date | rawData `averageSpO2Value` | `lowestSpO2Value` | `highestSpO2Value` | DB `avgSpO2` |
|---|---|---|---|---|
| 2026-03-30 | 94 | 83 | 99 | NULL |
| 2026-03-31 | 96 | 86 | 99 | NULL |
| 2026-04-01 | 93 | 84 | 100 | NULL |
| 2026-04-02 | 94 | 88 | 100 | NULL |
| 2026-04-03 | 93 | 84 | 99 | NULL |
| 2026-04-04 | 92 | 84 | 98 | NULL |
| 2026-04-05 | (없음) | — | — | NULL (정상 — 그날 미측정) |

`SleepRecord` 전 행에서 `avgSpO2` non-null = **0건**.

추가로 rawData top-level 에 `wellnessSpO2SleepSummaryDTO` (`averageSPO2` / `lowestSPO2` / `averageSpO2HR`) 가 중복 존재하며, `wellnessEpochSPO2DataDTOList` 에 260~463개 epoch 원본이 보존되어 있음 (Garmin 앱 그래프의 소스).

### 정상 동작 확인 (수정 대상 아님)

주간 SpO2 (`DailySummary.avgSpo2` / `lowestSpo2`) 는 **다른 엔드포인트(user-summary)** 이며 해당 페이로드의 실제 키가 `averageSpo2` / `lowestSpo2` 가 맞음. 모닝 리포트에 주간 값(평균 94% / 최저 87%)이 정상 출력되는 것이 근거. 이번 스코프에서 변경하지 않음.

## 2. 목표

1. 수면 SpO2 가 DB 에 정상 저장되도록 파싱 키 수정.
2. 과거 데이터를 **재싱크 없이** `rawData` 로부터 복구 (rawData 보존 정책의 실효 검증).
3. 수면 중 **최저/최고 SpO2** 를 신규 저장 — 수면 SpO2 는 평균보다 최저값의 임상적 의미가 큼 (야간 저산소 이벤트). 현재 리포트는 최저값을 주간 요약에서 끌어와 수면 중 실제 최저와 불일치.
4. 동일 오타 재발 방지를 위한 회귀 테스트 추가.

## 3. 요구사항

- [x] F1: `fetchers/sleep.ts` 가 `dailySleepDTO.averageSpO2Value` 를 읽어 `avgSpO2` 에 저장
- [x] F2: `wellnessSpO2SleepSummaryDTO.averageSPO2` 를 폴백으로 사용 (dailySleepDTO 결측 시)
- [x] F3: `SleepRecord` 에 `lowestSpO2` / `highestSpO2` (Float?) 컬럼 추가 + Prisma migration
- [x] F4: `lowestSpO2Value` / `highestSpO2Value` 파싱 + `wellnessSpO2SleepSummaryDTO.lowestSPO2` 폴백
- [x] F5: 파싱 로직을 순수 함수로 분리해 테스트 가능하게 (`extractSleepSpO2`)
- [x] F6: `scripts/backfill-m2-fields.ts` 동일 오타 수정 → rawData 기반 전 기간 복구
- [x] F7: MCP `get_sleep_records` 가 lowestSpO2 / highestSpO2 노출 + `_context` 해석 가이드 갱신
- [x] F8: 수면 상세 페이지에 최저/최고 SpO2 표시
- [x] F9: 봇 `/sleep` 응답에 SpO2 범위 표시
- [x] F10: 회귀 테스트 `scripts/test-sleep-spo2-parse.ts` — 실제 rawData shape 픽스처 기반

## 4. 기술 설계

### 4.1 파싱 순수 함수 분리

`src/lib/garmin/fetchers/sleep-spo2.ts` 신설:

```ts
export interface SleepSpO2 {
  avg: number | null;
  lowest: number | null;
  highest: number | null;
}

export function extractSleepSpO2(sleepData: unknown): SleepSpO2
```

우선순위:
1. `dailySleepDTO.averageSpO2Value` / `lowestSpO2Value` / `highestSpO2Value`
2. `wellnessSpO2SleepSummaryDTO.averageSPO2` / `lowestSPO2` (highest 는 summary DTO 에 없음 → null)

필드별 독립 폴백 (avg 만 있고 lowest 결측인 경우도 avg 는 살림).

### 4.2 값 검증

SpO2 는 백분율. `0 < v <= 100` 범위 밖이면 null 로 폐기 (센서 오류 · sentinel 값 방어).
`toFloat` 는 `Number("")` = 0 이므로 빈 문자열이 0 으로 통과하는 문제 방어 필요.

### 4.3 Migration

```sql
ALTER TABLE "SleepRecord" ADD COLUMN "lowestSpO2" DOUBLE PRECISION;
ALTER TABLE "SleepRecord" ADD COLUMN "highestSpO2" DOUBLE PRECISION;
```

Additive nullable — 기존 행 영향 없음. `prisma migrate reset` 금지 (data loss).

### 4.4 백필

`backfill-m2-fields.ts` 의 `backfillSleep()`:
- 현재 `where: { avgSpO2: null }` 조건이면 이미 처리된 행 skip. 오타 탓에 전 행이 null 이므로 그대로 두어도 전 행 대상이 되지만, `lowestSpO2` 도 함께 채워야 하므로 조건을 `OR` 로 확장.
- 신규 필드 3종 (`avgSpO2` / `lowestSpO2` / `highestSpO2`) 를 `extractSleepSpO2` 로 일괄 산출 → 파싱 로직 단일 소스.

### 4.5 표시 규칙

- SpO2 는 정수 % 로 표시 (도메인 룰: 심박수 bpm 정수와 동일 취급).
- 상세 페이지: 기존 `SpO2` Stat 유지 + `최저 SpO2` / `최고 SpO2` Stat 추가 (호흡수 최저/최고와 동일 패턴).
- 봇: `🫁 SpO2: 94% (최저 83%)` — 최저값 있을 때만 괄호 병기.

### 4.6 `lowestSpO2` 해석 기준 = 개인 baseline 상대 (중요)

`avgSpO2` 의 절대 임계 (95%+ 정상 / 90% 미만 주의) 를 `lowestSpO2` 에 그대로 적용하면 안 된다.

사전 리뷰 P1 지적: 이 사용자의 실측 `lowestSpO2` 는 §1 표 기준 **83 / 86 / 84 / 88 / 84 / 84** 로,
절대 임계 90% 를 적용하면 측정된 6/6 야간 전부가 "저산소 주의" 에 해당한다. 손목 광학 센서는
자세·압박에 따라 단발 저점이 80대 중반까지 흔히 내려가므로, 절대 임계 경고는 정보량이 0 이고
alert fatigue 로 실제 이상치를 묻어버린다.

따라서 AI 어드바이저 지침은 **개인 baseline 상대 판단**으로 고정한다:
- `src/mcp/tools/fitness.ts` `_context.lowestSpO2` — "최근 7일 최저값 대비 5%p 이상 하락이 2일 이상 반복될 때만 언급"
- `src/lib/ai/system-prompt.ts` `### SpO2` — 평균 임계를 최저값에 전이하지 말 것 + null 은 미측정으로 둘 것

이 항목은 프롬프트 문구라 자동 테스트 대상이 아니다. 변경 시 이 절을 함께 갱신한다.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `prisma/schema.prisma` | `SleepRecord.lowestSpO2` / `highestSpO2` 추가 |
| `prisma/migrations/<ts>_add_sleep_spo2_range/migration.sql` | 신설 |
| `src/lib/garmin/fetchers/sleep-spo2.ts` | 신설 — 순수 파싱 함수 |
| `src/lib/garmin/fetchers/sleep.ts` | `extractSleepSpO2` 사용 |
| `scripts/backfill-m2-fields.ts` | 동일 함수 사용 + where 조건 확장 |
| `src/mcp/tools/fitness.ts` | select 확장 + `_context` 갱신 |
| `src/lib/ai/system-prompt.ts` | `### SpO2` 해석 기준 갱신 (최저값 baseline 상대 · null 처리) |
| `src/app/sleep/[date]/page.tsx` | 신규 필드 전달 |
| `src/app/sleep/[date]/sleep-detail-client.tsx` | 최저/최고 SpO2 Stat |
| `src/bot/commands/sleep.ts` | SpO2 범위 표시 |
| `scripts/test-sleep-spo2-parse.ts` | 신설 — 회귀 테스트 |

## 6. 테스트 계획

### 회귀 테스트 (`scripts/test-sleep-spo2-parse.ts`)

- 실제 Garmin shape (`dailySleepDTO.averageSpO2Value` 등) → 정상 파싱 **← 이번 버그를 직접 노출하는 케이스**
- 구 오타 키 (`averageSpo2`) 만 있는 payload → null (잘못된 키가 다시 살아나지 않음을 보장)
- `dailySleepDTO` SpO2 결측 + `wellnessSpO2SleepSummaryDTO` 만 존재 → 폴백 동작
- 필드별 부분 결측 (avg 만 존재) → avg 만 채워지고 나머지 null
- 미측정 야간 (SpO2 키 전부 없음, 2026-04-05 실사례) → 전부 null
- 범위 밖 값 (0, -1, 150, "", "abc") → null
- `sleepData` 자체가 null/undefined/비객체 → 전부 null (크래시 없음)

### 3-check

`npm run lint && npm run typecheck && npm run build`

### 배포 후 검증

1. 마이그레이션 적용
2. `npx tsx scripts/backfill-m2-fields.ts` → 과거 SpO2 복구 확인
3. 다음 모닝 리포트에서 SpO2 값 출력 확인

## 7. 제외 사항

- `DailySummary` 주간 SpO2 파싱 — 정상 동작 확인됨, 변경 없음
- `wellnessEpochSPO2DataDTOList` (epoch 단위 원본) 저장/그래프화 — rawData 에 보존되어 있으므로 필요 시 별도 이슈
- `averageSpO2HRSleep` (SpO2 측정 중 평균 심박) 저장 — 활용처 불명확
- 저산소 이벤트 알림/경고 룰 — 별도 이슈
- 대시보드 SpO2 폴백 (`src/app/page.tsx:88` 이 수면 SpO2 결측 시 주간 SpO2 로 대체) 정리 — 후속 백로그 A-4
- SpO2 범위 포맷 로직 공용화 (봇 · 상세 페이지 중복) — 후속 백로그 A-4
