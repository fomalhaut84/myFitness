# Garmin 프로필 자동 싱크

## 목적

Garmin Connect의 두 API에서 maxHR / LTHR / Zone / VO2max 등 자동 측정값을 정기적으로 동기화하여, 사용자가 수동 입력 없이도 정확한 개인화 분석을 받도록 함. Garmin이 운동 후 자동 갱신하는 maxHR/Zone 변경도 자동 반영.

## 배경

기존 구현 (M4-1, M4-3):
- `UserProfile.maxHR / lthr / lthrPace / targetCalories / targetDate` 필드 존재
- 사용자 수동 입력 UI (`/settings/profile`)
- `targetCalories`는 Garmin `netCalorieGoal`에서 자동 싱크
- LTHR 기반 Zone 계산 (`src/lib/fitness/zones.ts`, Friel 공식)

## 데이터 소스

### A. `/biometric-service/heartRateZones` (★ 핵심)

sport별 array. **러닝 기준** (`sport: "RUNNING"`)으로 사용:

```json
{
  "trainingMethod": "HR_MAX",
  "maxHeartRateUsed": 175,
  "restingHeartRateUsed": 51,
  "lactateThresholdHeartRateUsed": 157,
  "zone1Floor": 88, "zone2Floor": 105, "zone3Floor": 123,
  "zone4Floor": 140, "zone5Floor": 158,
  "restingHrAutoUpdateUsed": true,
  "sport": "RUNNING",
  "changeState": "UNCHANGED"
}
```

**핵심 발견:**
- `maxHeartRateUsed` — 그동안 직접 가져올 수 없던 maxHR
- `zone1~5Floor` — Garmin이 계산한 정확한 Zone 경계 (자체 Friel 공식 대체 가능)
- `changeState` — "CHANGED" 등 값 변화 감지 (운동 후 조절 알림의 원천)
- `restingHeartRateUsed` — 안정시 심박 (Garmin 자동 추정)

### B. `/userprofile-service/userprofile/user-settings`

- `lactateThresholdSpeed: 0.31111024` — LTHR 페이스 (단위 검증 필요)
- `vo2MaxRunning: 45` — 러닝 VO2max
- `firstbeatRunningLtTimestamp: 1138544662` — LTHR 측정 시점 (epoch)
- `thresholdHeartRateAutoDetected: true` — Garmin 자동 감지 여부
- `birthDate / weight / height / gender` — 보조 정보
- `intensityMinutesCalcMethod / moderateIntensityMinutesHrZone / vigorousIntensityMinutesHrZone`

## 요구사항

### 데이터 동기화
- [ ] `biometric-service/heartRateZones` fetcher 신규
  - 러닝 sport(`sport === "RUNNING"`) row를 우선 사용. 없으면 DEFAULT.
  - `maxHeartRateUsed → UserProfile.maxHR`
  - `lactateThresholdHeartRateUsed → UserProfile.lthr`
  - `restingHeartRateUsed → UserProfile.restingHRBase`
  - `zone1~5Floor → UserProfile.heartRateZonesRaw` (JSON 보존)
  - `changeState !== "UNCHANGED"`면 변경 로깅
- [ ] `user-settings` fetcher 신규
  - `lactateThresholdSpeed → UserProfile.lthrPace` (단위 변환 후)
  - `vo2MaxRunning → UserProfile.vo2maxRunning`
  - `thresholdHeartRateAutoDetected, firstbeatRunningLtTimestamp → 메타`
- [ ] sync 파이프라인에 `user_profile` 데이터 타입 추가

### 자동값 vs 수동값 우선순위

**기존 동작 보존**: 사용자가 `/settings/profile`에서 수동 입력한 값이 있으면 자동 싱크가 덮어쓰지 않음.

```typescript
if (profile.maxHR === null) {
  profile.maxHR = garminMaxHR;
  profile.maxHRSource = "garmin";  // 신규 필드
}
// profile.maxHR가 수동 설정이면 건드리지 않음.
// 단, source 필드로 "manual" vs "garmin" 구분.
```

UI에서:
- "Garmin 자동" 배지 표시
- "Garmin 값으로 재설정" 버튼 (수동 → 자동 되돌리기)
- `changeState === "CHANGED"` 발생 시 토스트/알림

### Zone 계산 정책

Garmin이 직접 계산한 `zone1~5Floor` 값을 우선 사용. Garmin 데이터 없으면 기존 Friel 공식 폴백.

```typescript
function getZoneRanges(profile): ZoneRange[] {
  if (profile.heartRateZonesRaw) {
    // Garmin 값 그대로 (zone1Floor ~ zone5Floor + maxHR)
    return parseGarminZones(profile.heartRateZonesRaw);
  }
  // 기존 Friel 공식 fallback
  return computeFrielZones(profile.lthr, profile.maxHR);
}
```

### 자동 동기화 스케줄
- [ ] cron 자동 실행 (3시간 사이클 포함, `bootstrapNewTypes: true`)
- [ ] 매번 호출 비용 작음 — `changeState` 감지가 핵심이므로 자주 폴링

### 변경 내역 트래킹 (★)

각 수치(maxHR, LTHR, restingHR, lthrPace, vo2maxRunning)의 변경 이력을 별도 테이블에 누적 저장하여, 시간 경과에 따른 피트니스 변화 추적.

- [ ] `MetricChange` 모델 신규
- [ ] Garmin 싱크에서 값 변경 감지 시 자동 기록
- [ ] `/api/profile` PATCH 시 수동 변경 기록
- [ ] `/settings/profile`에 "변경 이력" 섹션
  - 필드별 timeline 차트 (Recharts)
  - 최근 변경 피드 (날짜, 필드, 이전→새값, source)
- [ ] MCP `get_metric_history(field?, days?)` 도구
  - AI가 "LTHR이 언제부터 올랐어?", "최대심박 추세는?" 등 질문에 답변

### MCP/API
- [ ] MCP `get_user_profile` — 프로필 + Zone + paceZone 통합 조회 (각 값에 source 표기)
- [ ] `POST /api/profile/sync-garmin` — 즉시 강제 싱크 (수동 트리거)

### UI
- [ ] `/settings/profile` 페이지에 "Garmin 자동 동기화" 섹션
  - 마지막 싱크 시각 (`garminSyncedAt`)
  - sport별 zone 표 (러닝/DEFAULT 모두)
  - 자동 감지 배지 (lthr/maxHR 옆)
  - "지금 싱크" / "Garmin 값으로 재설정" 버튼
- [ ] 변경 감지 시 대시보드 배너 (1회 노출 후 dismiss)

## 기술 설계

### 스키마 확장

```prisma
model UserProfile {
  // ... 기존 필드 (M4-1, M4-6)
  vo2maxRunning            Float?    // Garmin VO2max
  maxHRSource              String?   // "manual" | "garmin"
  lthrSource               String?   // "manual" | "garmin"
  lthrAutoDetected         Boolean?  // Garmin thresholdHeartRateAutoDetected
  lthrMeasuredAt           DateTime? // firstbeatRunningLtTimestamp 변환
  heartRateZonesRaw        Json?     // Garmin 원본 zone1~5Floor + maxHR (러닝)
  garminSyncedAt           DateTime? // 마지막 user-settings/biometric 싱크
}

// 변경 이력 트래킹
model MetricChange {
  id         String   @id @default(cuid())
  field      String   // "maxHR" | "lthr" | "lthrPace" | "vo2maxRunning" | "restingHRBase"
  oldValue   Float?   // 이전 값 (null이면 최초 설정)
  newValue   Float?   // 새 값 (null이면 삭제)
  source     String   // "manual" | "garmin"
  reason     String?  // "user_edit" | "garmin_auto_detect" | "garmin_change_state" | "garmin_initial"
  changedAt  DateTime @default(now())

  @@index([field, changedAt])
  @@index([changedAt])
}
```

### MetricChange 기록 로직

```typescript
// src/lib/fitness/profile-history.ts
export async function recordMetricChange(args: {
  field: string;
  oldValue: number | null;
  newValue: number | null;
  source: "manual" | "garmin";
  reason?: string;
}) {
  // 값이 동일하면 기록 skip
  if (args.oldValue === args.newValue) return;
  await prisma.metricChange.create({
    data: {
      field: args.field,
      oldValue: args.oldValue,
      newValue: args.newValue,
      source: args.source,
      reason: args.reason ?? null,
    },
  });
}
```

호출 지점:
1. `/api/profile` PATCH — 각 필드 비교 후 변경된 것만 기록 (`source: "manual", reason: "user_edit"`)
2. Garmin 싱크 — 자동값 갱신 시 (`source: "garmin"`, reason은 `changeState`에 따라 결정)

### Garmin Speed → Pace 변환

`lactateThresholdSpeed: 0.31111024`. 사용자 실측 LTHR 페이스 5:21/km(=321 sec/km)와 비교하여 단위 추정.

가설 A: × 10 = m/s
- 0.31 × 10 = 3.1 m/s → 1000/3.1 = 322 sec/km ≈ 5:22/km ✓ (가장 유력)

확정 안되면 `lthrPace` 자동 싱크 보류. LTHR 심박만 싱크.

### Sport 선택 로직

```typescript
function pickRunningZones(zonesArray: GarminHRZone[]): GarminHRZone | null {
  return (
    zonesArray.find((z) => z.sport === "RUNNING") ??
    zonesArray.find((z) => z.sport === "DEFAULT") ??
    null
  );
}
```

### MCP get_metric_history 응답

```typescript
{
  field: "lthr" | "maxHR" | ...,
  period: "최근 N일",
  changes: [
    { date: "2026-04-22", oldValue: 155, newValue: 157, source: "garmin", reason: "garmin_change_state" },
    { date: "2026-03-15", oldValue: 153, newValue: 155, source: "garmin", reason: "garmin_auto_detect" },
    ...
  ],
  summary: {
    firstValue: 153,
    latestValue: 157,
    changeCount: 2,
    netChange: +4,
  }
}
```

### MCP get_user_profile 응답

```typescript
{
  name: string,
  birthDate: string | null,
  maxHR: { value: number, source: "manual" | "garmin" | "estimated" },
  lthr: { value: number | null, source: "manual" | "garmin" | null, autoDetected: boolean },
  lthrPace: { value: number | null, source: "manual" | "garmin" | null }, // sec/km
  vo2maxRunning: number | null,
  restingHR: number | null,
  targetWeight: number | null,
  targetCalories: number | null,
  targetDate: string | null,
  heartRateZones: {
    z1: { min: 0, max: number, label: string },
    z2: { min: number, max: number, label: string },
    ...
  },
  zoneSource: "garmin" | "calculated",
  garminSyncedAt: string | null,
}
```

### 페이스 Zone 계산

LTHR 페이스를 100%로 두고 Friel 기준:
```
Z1 회복: > 129% LTHR pace (느림)
Z2 이지: 114-129%
Z3 템포: 106-113%
Z4 역치: 99-105%
Z5 VO2: < 99% (빠름)
```

페이스는 sec/km이라 % 큰 게 느림.

### 변경 감지

```typescript
// 싱크 시점
if (newGarminMaxHR !== profile.maxHR && profile.maxHRSource === "garmin") {
  await prisma.aIAdvice.create({
    data: {
      category: "system_event",
      prompt: "max_hr_changed",
      response: `Garmin이 최대 심박을 ${profile.maxHR}→${newGarminMaxHR}bpm으로 갱신`,
    },
  });
}
```

향후 대시보드 알림 영역에서 system_event 표시.

## 테스트 계획

- [ ] `lactateThresholdSpeed` 단위 검증 (실제 페이스와 대조)
- [ ] 첫 싱크 시 자동 maxHR/LTHR/Zone 반영 + MetricChange 초기 row 생성
- [ ] 수동 입력 후 재싱크 시 수동값 보존
- [ ] Garmin maxHR 변화 시뮬레이션 → 변경 알림 생성 + MetricChange 기록
- [ ] /api/profile PATCH 시 변경된 필드만 MetricChange 기록 (동일값은 skip)
- [ ] zoneSource가 "garmin"이면 Garmin Floor 값 사용, 없으면 Friel 폴백
- [ ] MCP `get_user_profile` 응답 검증
- [ ] MCP `get_metric_history(field)` 응답 검증
- [ ] `/settings/profile`에 source 시각적 구분 + 변경 이력 timeline 차트
- [ ] lint + tsc + build 통과

## 제외 사항 (백로그)

- 페이스 Zone 사용자 커스터마이징 (Friel 기본값 사용)
- 키/체중 user-settings 동기화 (별도 BodyComposition 사용 중)
- DEFAULT sport(non-running) 별도 활용 — 현재 러닝 중심 앱이라 보류
