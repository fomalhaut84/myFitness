# [feat] 활동 시점 기상 정보 저장 + AI 노출

- **작성일**: 2026-07-29
- **이슈**: #269 (예정)
- **선행**: #261 (routeTag) — Activity 확장 패턴 참조. `Activity.rawData.startLatitude/Longitude` 이미 확보.
- **범위**: Activity 스키마 확장 (손목 온도 파싱 + 외부 기상 필드) + Open-Meteo fetcher + sync 통합 + 히스토리 backfill + MCP/UI 노출

## 배경

현재 활동 기록에는 기상 정보가 없어서 다음이 불가능:
- "습한 날엔 페이스 저하가 크더라" 같은 사후 분석
- 컨디션 나쁜 날의 원인 후보에서 기상 배제/식별
- 여름철 고온·고습·강우 훈련 부하 보정

Garmin `rawData.maxTemperature/minTemperature` 는 손목 센서 측정으로, 햇빛·의류·피부열 영향을 받아 실제 기온과 차이가 큼. **손목 측정값과 외부 기상 실측치를 분리해서** 각각 저장·노출한다. 손목 온도는 "환경 스트레스 지표" 로서 여전히 유용.

## 목표

- [ ] Activity 스키마 확장 (nullable 필드)
  - [ ] `wristTempMaxC Float?` — Garmin rawData.maxTemperature 파싱
  - [ ] `wristTempMinC Float?` — Garmin rawData.minTemperature 파싱
  - [ ] `weatherTempC Float?` — Open-Meteo 활동 시작 시점 기온 (°C)
  - [ ] `weatherApparentTempC Float?` — 체감 온도 (°C)
  - [ ] `weatherHumidityPct Int?` — 상대 습도 (%)
  - [ ] `weatherWindMs Float?` — 풍속 (m/s)
  - [ ] `weatherPrecipMm Float?` — 활동 시간대 누적 강수량 (mm)
  - [ ] `weatherCode Int?` — WMO weather interpretation code
  - [ ] `weatherFetchedAt DateTime?` — API 호출 성공 시각 (재fetch 판정용)
  - [ ] `weatherSource String?` — 데이터 소스 (`open-meteo`)
- [ ] Open-Meteo fetcher (`src/lib/weather/open-meteo.ts`)
  - [ ] `fetchArchiveWeather(lat, lng, startTimeUtc, durationSec)` — 과거 시점 기상 조회
  - [ ] Rate limit 방어 (retry + backoff, 실패 시 null 반환)
- [ ] Activity sync 훅
  - [ ] Garmin activity fetcher 완료 후, 새 activity 마다 손목 온도 파싱 + Open-Meteo fetch
  - [ ] GPS 시작점 없음 (실내) → 외부 기상 fetch skip, 손목 값만 저장
  - [ ] weather fetch 실패 → weather* 필드 null 유지, `weatherFetchedAt` 도 null (다음 backfill 에서 재시도)
- [ ] 히스토리 backfill 스크립트 (`scripts/backfill-weather.ts`)
  - [ ] `weatherFetchedAt IS NULL AND activityType includes running AND rawData.startLatitude != null` 조건으로 순회
  - [ ] Open-Meteo rate limit (일 10,000 calls) 존중 — sleep(200ms) between calls
  - [ ] 진행률 로그 (몇 건 처리/총 몇 건/실패)
  - [ ] npm script `npm run backfill:weather` 등록
- [ ] MCP tool 응답에 weather* + wristTemp* 노출
  - [ ] `fitness.ts` getActivities (select + 스프레드)
  - [ ] `splits.ts` getActivitySplits summary (특히 개별 활동 상세 분석에 유용)
  - [ ] `weight-loss.ts`, `pace-progression.ts` 는 선택 (over-exposure 회피)
- [ ] UI 노출
  - [ ] 활동 상세 페이지에 "환경" 섹션 (외부 기상 우선, 손목 온도 보조)
  - [ ] `null` 필드는 표시 생략

## 기술 설계

### 1) Prisma 스키마 (Activity 확장)

```prisma
model Activity {
  // ... 기존 필드
  // #269: 손목 측정 온도 (Garmin rawData). 실제 기상과 다를 수 있음 (햇빛/의류 영향).
  wristTempMaxC        Float?
  wristTempMinC        Float?
  // #269: 외부 기상 실측치 (Open-Meteo, 활동 시작 시점 기준).
  weatherTempC         Float?
  weatherApparentTempC Float?
  weatherHumidityPct   Int?
  weatherWindMs        Float?
  weatherPrecipMm      Float?
  weatherCode          Int?
  weatherFetchedAt     DateTime?
  weatherSource        String?
}
```

Manual SQL migration (`prisma/migrations/YYYYMMDDHHMMSS_activity_weather/migration.sql`) 로 추가. 모두 nullable → 기존 데이터 안전. 인덱스는 걸지 않음 (분석은 in-memory 필터가 대부분).

### 2) Open-Meteo Archive API

- Endpoint: `https://archive-api.open-meteo.com/v1/archive`
- Params:
  - `latitude`, `longitude`
  - `start_date=YYYY-MM-DD`, `end_date=YYYY-MM-DD` (UTC 기준)
  - `hourly=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code`
  - `timezone=UTC` (activity.startTime 이 UTC)
- 응답: 시간별 배열. 활동 시작 시각 (`floor(startTime to hour)`) 인덱스로 값 pick.
- 강수량은 활동 duration 커버 시간대 누적 합계.

**Rate limit**: 무료 티어 명시 상한 없음, 하지만 관례적으로 10k/day. 신규 sync 는 하루 활동 1~3건이라 여유. Backfill 은 delay 200ms.

**에러 정책**:
- 4xx (bad request, invalid coord) → weather* null 저장 + `weatherFetchedAt = null` (재시도 무의미하므로 사실은 sentinel 이 필요할 수 있음 — v1 은 재시도 허용)
- 5xx / timeout → 즉시 null (다음 backfill 사이클에서 재시도)
- 응답에 필드 누락 → 해당 필드만 null

### 3) 손목 온도 파싱

```typescript
function parseWristTemps(rawData: unknown): { max: number | null; min: number | null } {
  if (!rawData || typeof rawData !== "object") return { max: null, min: null };
  const raw = rawData as { maxTemperature?: number | null; minTemperature?: number | null };
  return {
    max: typeof raw.maxTemperature === "number" ? raw.maxTemperature : null,
    min: typeof raw.minTemperature === "number" ? raw.minTemperature : null,
  };
}
```

Sync 훅에서 activity upsert 직후 실행. rawData 는 이미 저장되어 있음.

### 4) Sync 통합 위치

`src/lib/garmin/fetchers/activity.ts` (신규 activity upsert 완료 후) 에 후처리 함수 호출:
- 손목 온도 파싱 → 즉시 update
- GPS 확보 시 → Open-Meteo fetch (실패해도 sync 자체는 성공 유지)

Weather fetch 실패로 sync 가 실패하면 안 됨 — 개별 activity 단위 try-catch.

### 5) Backfill 스크립트

```typescript
// scripts/backfill-weather.ts
// 사용: npm run backfill:weather [--limit N] [--dry-run]
//
// running-family activity 중 weatherFetchedAt IS NULL & rawData.startLatitude != null 을
// 오래된 순으로 처리. 각 건마다 200ms sleep. 결과: OK / 실패 카운트.
```

일회성이지만 향후 API 변경 등으로 재수행 여지 있음 → 유지.

### 6) MCP 응답 확장

- `fitness.ts` `getActivities`: select 에 `wristTempMaxC/MinC` + `weather*` 추가, 스프레드로 자동 노출
- `splits.ts` `getActivitySplits` summary: 활동 시작 시점 대표 필드만 (`weatherTempC`, `weatherHumidityPct`, `weatherPrecipMm`, `weatherCode`) — laps 마다 반복하지 않음

### 7) UI 노출 (활동 상세 페이지)

- 새 `EnvironmentSection` (server component): 외부 기상 우선, 손목 온도 보조 표시
- 예:
  ```
  기상 (Open-Meteo)  22.4°C · 체감 24.1°C · 습도 78% · 바람 3.2m/s · 강수 0mm
  손목 센서         최고 31°C / 최저 26°C
  ```
- 두 값 모두 null → 섹션 자체 숨김. 하나만 있으면 있는 쪽만 표시.

## 테스트 계획

- **단위**: `parseWristTemps` (rawData shape 변형), `fetchArchiveWeather` (mock fetch 로 응답 shape 파싱 검증)
- **통합**: 신규 activity sync 시 손목 온도 & weather 저장 확인 (실제 API 는 mocking)
- **backfill 스크립트**: `--dry-run` 옵션으로 대상 카운트만 출력 검증
- **회귀**: sync 실패 시 (weather fetch 예외) activity 자체는 저장되어야 함

## 제외 사항

- 기상 예보 (미래 활동 계획 지원). 별도 이슈.
- 활동 중 시계열 기상 (분 단위 변화). start time 시점 대표값만 저장.
- 대기질 (AQI, PM2.5). 별도 API 필요, 후속 논의.
- 기상 데이터를 조건으로 하는 분석 로직 (예: "고온 스트레스 점수"). AI 프롬프트에서 자연스럽게 소화 → 별도 로직 불필요.

## 마이그레이션 노트

- 신규 컬럼 모두 nullable → 다운타임 없음
- `prisma migrate deploy` 로 자동 적용 (`deploy/deploy.sh`)
- 배포 직후 backfill 스크립트 수동 실행 필요 (`npm run backfill:weather` on 운영 서버)
- Open-Meteo 는 인증 불필요 → 신규 secret 없음

## 관련 메모리

- `project_weather_wrist_separation` — 손목 온도 vs 기상 분리 원칙
