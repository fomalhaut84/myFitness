# M5-2-1: `get_readiness_score` MCP 도구

- **작성일**: 2026-06-22
- **타입**: feature (P1)
- **마일스톤**: M5-2 (`docs/specs/m5-overview.md`)
- **백엔드 전용** — UI 변경 없음 (디자인 단계 생략)

## 1. 목적

AI가 모닝/이브닝 리포트에서 "오늘 강도를 어떻게 잡을지" 판단할 때 매번 sleep/dailyStats/activities 도구 3종을 불러 직접 계산해야 했음. 회복 점수를 결정적·정확하게 단일 도구로 제공해 (a) AI 토큰 절약, (b) 일관된 평가 기준, (c) 강도 추천의 결정적 산출.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: 신규 MCP 도구 `get_readiness_score` 등록. 입력 파라미터 없음(오늘 기준 단일 호출).
- [ ] **F2**: 핵심 점수 = 오늘 아침의 `DailySummary.bodyBatteryHigh` (Garmin 자체 회복 지표, 0-100). null/누락 시 컨텍스트만 반환하고 점수는 `null`.
- [ ] **F3**: 상태 라벨 분류 (강도 추천 1줄 포함):
  - 90-100 `optimal` — "고강도 훈련 가능 (인터벌, 템포)"
  - 75-89 `good` — "중-고강도 훈련 권장 (LT 페이스, 장거리)"
  - 50-74 `moderate` — "중강도 또는 회복주"
  - 30-49 `fatigued` — "저강도 회복주 권장"
  - 0-29 `depleted` — "휴식 권장"
- [ ] **F4**: 컨텍스트 지표(AI가 판단 보강에 사용):
  - `hrvOvernight` 오늘 야간 값 + 7일 평균 + deviation (ms / %)
  - `restingHR` 오늘 + 7일 평균 + deviation (bpm)
  - `sleepScore` 오늘 + 7일 평균
  - `yesterdayLoad`: 어제 Activity 의 `intensityScore` 합계(M4-5에서 산출된 TRIMP-유사 0~100) + `duration` 총합(분) + `aerobicTE` / `anaerobicTE` 최대값
- [ ] **F5**: 응답은 JSON 직렬화 가능한 단일 객체. MCP 표준 응답(`{ content: [{ type: "text", text: JSON.stringify(...) }] }`).
- [ ] **F6**: 응답 본문 ≤ 500 토큰 (대략 ≤ 2KB JSON).

### 2.2 비기능 요구사항

- [ ] KST 기준 날짜 계산 (다른 도구와 동일 — `todayKST`, `daysAgoKST` 사용).
- [ ] DB 쿼리 ≤ 3건 (Promise.all 병렬).
- [ ] 데이터 누락(예: 오늘 SleepRecord 없음)에 대해 graceful — null 표기, throw 안 함.

## 3. 기술 설계

### 3.1 데이터 입력

```
DailySummary today     → bodyBatteryHigh, restingHR (백업)
DailySummary 7d range  → restingHR 7d avg (오늘 제외)
SleepRecord today      → hrvOvernight, sleepScore, restingHR
SleepRecord 7d range   → hrvOvernight 7d avg, sleepScore 7d avg
Activity yesterday     → intensityScore sum, duration sum, aerobicTE / anaerobicTE max
```

### 3.2 점수 산출

기본 점수는 `DailySummary.bodyBatteryHigh`. Garmin이 이미 HRV/RHR/수면/스트레스를 종합한 휴식 지표를 산출하므로 자체 가중합 없이 그대로 사용. 우리는 라벨링 + 컨텍스트 부가.

대안 검토:
- 자체 가중합 (HRV 25% + RHR 25% + 수면 25% + 어제 로드 25%) → 가중치 튜닝 어려움, Garmin 지표보다 노이즈 큼
- HRV 단일 → 데이터 누락 시 사용 불가
- → bodyBatteryHigh + 컨텍스트 보강이 가장 robust

### 3.3 라벨 + 강도 추천

```ts
function classify(score: number): { label: string; recommendation: string } {
  if (score >= 90) return { label: "optimal", recommendation: "고강도 훈련 가능 (인터벌, 템포)" };
  if (score >= 75) return { label: "good", recommendation: "중-고강도 훈련 권장 (LT 페이스, 장거리)" };
  if (score >= 50) return { label: "moderate", recommendation: "중강도 또는 회복주" };
  if (score >= 30) return { label: "fatigued", recommendation: "저강도 회복주 권장" };
  return { label: "depleted", recommendation: "휴식 권장" };
}
```

### 3.4 응답 스키마

```ts
{
  date: "2026-06-22",                    // 오늘 KST YYYY-MM-DD
  score: 78 | null,                      // bodyBatteryHigh (없으면 null)
  label: "good" | null,
  recommendation: "중-고강도 훈련 권장 (LT 페이스, 장거리)" | null,
  context: {
    hrv: {
      today: 45.2 | null,                // ms
      avg7d: 42.8 | null,
      deviationPct: 5.6 | null,          // (today - avg7d) / avg7d * 100, 양수=좋음
    },
    restingHR: {
      today: 52 | null,                  // bpm (SleepRecord 우선, fallback DailySummary)
      avg7d: 54 | null,
      deviationBpm: -2 | null,           // today - avg7d, 음수=좋음
    },
    sleep: {
      score: 82 | null,
      avg7d: 78 | null,
    },
    yesterdayLoad: {
      totalIntensityScore: 145 | null,  // M4-5의 TRIMP-유사 점수(0~100)의 합계
      totalDurationMin: 65 | null,
      maxAerobicTE: 3.4 | null,
      maxAnaerobicTE: 1.2 | null,
    },
  },
}
```

`null` 처리: 데이터 누락 시 명시적으로 `null`. AI 가 그 사실을 알고 판단.

## 4. 변경 파일

- `src/mcp/tools/readiness.ts` *(신규)* — `getReadinessScore` 비즈니스 로직
- `src/mcp/server.ts` — `server.tool("get_readiness_score", ...)` 등록
- (테스트 인프라 없음 — `npm run lint && npm run typecheck && npm run build` 로 검증)

## 5. 테스트 계획

### 5.1 정적 검증

`npm run lint && npm run typecheck && npm run build` 3종 통과.

### 5.2 수동 검증 (로컬)

- MCP 서버 빌드 후 직접 호출 (예: claude code CLI에서 도구 사용 시뮬레이션)
- 데이터 없는 날짜(예: SleepRecord 없음) 시 graceful null 처리 확인
- `bodyBatteryHigh` 5단계 라벨 모두 분기 확인

### 5.3 통합 검증

운영 적용 후 다음 모닝/이브닝 리포트가 도구를 활용하는지 PM2 로그 / Claude 응답에서 확인.

## 6. 제외 사항

- 자체 가중합 회복 점수 — Garmin bodyBatteryHigh 사용
- 추세 차트 / 시각화 — UI 변경 없음
- 시스템 프롬프트 변경 (도구 권장 사용 시점 안내) — 별도 PR (M5-3 에서 통합 검토)
- 활용처 확장(텔레그램 `/today` 등) — 추후

## 7. 롤백

- `git revert <merge-sha>` 후 재빌드. DB / 환경변수 영향 없음.
- 신규 도구이므로 기존 호출자에게 영향 없음.
