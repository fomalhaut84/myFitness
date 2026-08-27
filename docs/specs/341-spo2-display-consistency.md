# SpO2 표시 일관성 정리 (#338 후속)

- **작성일**: 2026-08-27
- **타입**: fix
- **이슈**: #341
- **우선순위**: P1
- **출처**: #338 사전 리뷰 P0 2건 → 백로그 A-4

## 1. 배경

v2.26.2 (#338) 에서 수면 SpO2 파싱 버그를 고치면서, AI 어드바이저 지침을 다음과 같이 확정했다:

> `avgSpO2` 가 null 이면 그날 밤 미측정이다. **주간 SpO2 로 대체 판단하지 말 것.**
> (`src/mcp/tools/fitness.ts` `_context.avgSpO2`, `src/lib/ai/system-prompt.ts` `### SpO2`)

그런데 대시보드는 정확히 그 대체를 수행한다:

`src/app/page.tsx:88` · `:100`
```ts
spo2: todaySleep?.avgSpO2 ?? todaySummary?.avgSpo2 ?? null,
```

수면 SpO2 (야간 측정) 와 주간 SpO2 (`DailySummary.avgSpo2`, 활동 중 산발 측정) 는 측정 환경이 달라 값의 의미가 다르다. 미측정 야간에는 **대시보드 카드는 주간값을, 모닝 리포트는 "측정값 없음" 을** 보여 같은 날짜에 두 surface 가 어긋난다 — #338 제보를 유발한 혼선(앱에는 보이는데 리포트에는 없음)과 같은 계열이다.

추가로 `평균% (최저 N%)` 포맷이 두 곳에 각각 구현되어 있어 한쪽만 고치면 표시 규칙이 갈라진다.

## 2. 목표

1. 대시보드 SpO2 카드가 값의 출처를 숨기지 않도록 한다 (AI 지침과 정합).
2. SpO2 포맷 로직을 단일 소스로 통합한다.

## 3. 요구사항

- [x] F1: 대시보드 SpO2 카드가 수면 SpO2 결측 시 주간값임을 명시 (label 분기) 하거나 폴백을 제거
- [x] F2: SpO2 포맷 헬퍼 단일화 — 봇 · 수면 상세 페이지가 같은 구현 사용
- [x] F3: 회귀 테스트 — 폴백/label 분기 로직

## 4. 기술 설계

### 4.1 대시보드 폴백 (F1)

**선택지**:
- (a) 폴백 제거 → 미측정 야간엔 카드 자체가 사라짐 (`spo2 != null` 조건부 렌더)
- (b) 폴백 유지 + label 분기 → `SpO2` / `SpO2 (주간)`

**(b) 채택**. 이유: 주간 SpO2 도 사용자에게 의미 있는 정보이고 (`DailySummary.avgSpo2` 는 정상 동작), 카드가 날마다 나타났다 사라지는 것보다 출처 표시가 정보 손실이 적다. AI 지침과의 충돌은 "대체 판단 금지" 가 핵심이므로 **출처만 명시되면 해소**된다.

`todayData` / `yesterdayData` shape 에 `spo2Source: "sleep" | "daily" | null` 추가. `dashboard-client.tsx` 의 SummaryCard label 을 source 로 분기.

**주의**: `prevValue` (어제 대비) 비교 시 today/yesterday 의 source 가 다르면 **서로 다른 측정 종류를 비교**하게 된다. source 불일치면 `prevValue` 를 넘기지 않는다 (delta 표시 생략).

### 4.2 포맷 헬퍼 단일화 (F2)

현재 중복:
- `src/bot/commands/sleep.ts` — `🫁 SpO2: 94% (최저 83%)`
- `src/app/sleep/[date]/sleep-detail-client.tsx` — `fmtSpO2(avg, lowest)` (AI 프롬프트용, 결측 시 `"측정없음"`)

봇은 `src/bot/utils/formatter.ts` 를, 웹은 `src/lib/format.ts` 를 쓴다. **`src/lib/format.ts` 를 단일 소스로 선택** — 봇 번들이 `@` alias 를 통해 `src/lib` 를 이미 참조 가능하고 (`build:bot` 의 `--alias:@=./src`), 도메인 표시 규칙은 layer 중립이어야 하기 때문.

```ts
// src/lib/format.ts
export function fmtSpO2(
  avg: number | null,
  lowest?: number | null,
  opts?: { fallback?: string },
): string
```
- `avg` null → `opts.fallback ?? "-"`
- `lowest` 있으면 ` (최저 N%)` 병기
- 정수 % (도메인 룰)

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/format.ts` | `fmtSpO2` 신설 |
| `src/app/page.tsx` | `spo2Source` 산출 |
| `src/app/dashboard-client.tsx` | label 분기 + source 불일치 시 prevValue 생략 |
| `src/app/sleep/[date]/sleep-detail-client.tsx` | 로컬 `fmtSpO2` 제거 → 공용 사용 |
| `src/bot/commands/sleep.ts` | 공용 `fmtSpO2` 사용 |
| `scripts/test-spo2-format.ts` | 신설 — 포맷 · source 분기 회귀 테스트 |

## 6. 테스트 계획

- `fmtSpO2` — avg만 / avg+lowest / avg null+fallback / 소수점 반올림 / lowest만 있고 avg null
- source 판정 — 수면값 존재 / 수면 결측+주간 존재 / 둘 다 결측
- prevValue 생략 — today=sleep · yesterday=daily 조합
- 3-check

## 7. 제외 사항

- 주간 SpO2 (`DailySummary.avgSpo2`) 파싱 자체 — 정상 동작, 변경 없음
- 봇 formatter (`src/bot/utils/formatter.ts`) 전체를 `src/lib/format.ts` 로 통합 — 이번은 SpO2 만. 전면 통합은 별도 이슈
