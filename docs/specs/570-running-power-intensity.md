# [feat] 러닝 파워 역치 · 존 동기화 + 강도 평가 기준 선택 (심박 / 파워 / 자동)

- **작성일**: 2026-10-20
- **타입**: feat
- **이슈**: #570 (원 제안 pleiades#175 — 서비스 저장소에서 진행하기로 결정)
- **진행 방식**: myFitness 코드 프리징 **1회 해제** (사용자 2026-10-20). 범위는 이 이슈 하나 → dev → main 릴리즈 → 바로 재동결. 재동결 후 pleiades 가 fit 수용 1회 (의도된 뒤처짐).
- **단계**: PR 2개 — `feat/570-1` 백엔드 (스키마 · 싱크 · 강도 계산 · MCP · 프롬프트 컨텍스트) → `feat/570-2` UI (프로필 설정 · 활동 상세 · 인사이트 문구)
- **개인정보**: 이 문서 · 이슈 · 커밋 · fixture 에 개인 건강 정보 (복약 · 진단 · 실측 심박 비교값) 를 쓰지 않는다. 예시 값은 가상 값 (memory `feedback-health-data-public-repo`).

## 1. 배경

- 활동 강도 (`Activity.zoneDistribution` · `estimatedZone` · `intensityScore` · `intensityLabel`) 는 싱크 때 **심박 존 시간 (`hrTimeInZone_1~5`) 만으로** 계산된다 (`src/lib/fitness/intensity.ts` `computeIntensityFromRawData`). 이 값이 활동 상세 · AI 운동 평가 · 이브닝/주간 리포트 (80/20) · 훈련 부하 · ACWR · 준비도 · 체중 감량 판단에 그대로 쓰인다.
- **심박 반응을 바꾸는 요인** (심박을 낮추는 약물, 더위, 탈수, 피로 누적 등) 이 있으면 같은 페이스 · 같은 코스에서도 심박이 낮게 / 높게 나와 강도 판정이 실제와 어긋난다. 사용자가 이 왜곡을 실제로 겪고 있고, 매번 대화로 "파워 기준으로 다시 봐 달라" 고 요청해야 하는 상태다.
- 러닝 파워는 페이스 · 경사 · 케이던스 기반 기계적 출력이라 이런 요인의 영향을 덜 받는다. 사용자 워치는 러닝 역치파워를 자체 산출하고, 활동 원본에도 파워 존 시간이 이미 있다 — **시스템이 이 값을 받지 않을 뿐이다.**

### Garmin 실측 (2026-10-20 · 읽기 전용 호출 · `.runtime/570-poc/probe.ts`)

| 엔드포인트 | 내용 |
|---|---|
| `GET /biometric-service/powerZones/sports/all` | 종목별 배열. `sport: "RUNNING"` 항목에 `functionalThresholdPower` (W) · `zone1Floor ~ zone5Floor` (W) · `zone6Floor`/`zone7Floor` = 0 (러닝은 5존). 실측 비율 = 역치 대비 **65 · 80 · 90 · 100 · 115%** |
| `GET /biometric-service/biometric/latestFunctionalThresholdPower/RUNNING` | `functionalThresholdPower` · `calendarDate` (감지/변경 시각 · naive 로컬) · `biometricSourceType` (`CHANGE_LOG` 등) · `isStale` |
| `GET /biometric-service/powerZones/sports/RUNNING` | **404** — 단일 종목 경로는 없다. `all` 을 받아 RUNNING 을 고른다 |
| `user-settings` `userData.ftpAutoDetected` | `true` — 자동 감지 여부 (LTHR 의 `thresholdHeartRateAutoDetected` 와 같은 성격) |
| `Activity.rawData` | `powerTimeInZone_1~5` (초) · `avgPower` · `normPower` · `maxPower` 가 이미 저장돼 있다. **과거 활동도 재싱크 없이 파워 기준 재계산 가능** |

## 2. 결정

1. **강도 기준 설정 = `hr` · `power` · `auto`** (UserProfile 1개 값). `auto` = 그 활동에 파워 존 데이터가 있으면 파워, 없으면 심박 (활동 단위 판정).
2. **기본값 `hr`** — 배포만으로 기존 기록 · 리포트가 바뀌지 않는다. 사용자가 설정에서 바꾼다.
3. **저장 구조 = 강도 컬럼 1벌 + `Activity.intensityBasis`** (`hr` | `power`, 그 행을 만든 기준). 읽는 쪽 (15곳+) 은 지금처럼 `{z1..z5}` 를 읽고, 기준 표시가 필요한 곳만 `intensityBasis` 를 본다. 두 기준을 다 저장해 읽을 때 고르는 방식은 읽기 지점 전부를 바꿔야 해서 택하지 않는다.
4. **설정을 바꾸면 전체 활동 강도를 새 기준으로 재계산**한다 (원본 `rawData` 만으로 — Garmin 호출 없음). 훈련 부하 · ACWR 이력이 기준이 섞이지 않게 하기 위함. `auto` 는 활동별로 섞이는 것을 허용한다 (파워 없는 옛 활동은 심박).
5. **파워 존 분포는 Garmin 이 계산한 `powerTimeInZone_1~5` 를 그대로** 쓴다 (심박도 Garmin 의 `hrTimeInZone` 을 쓰는 것과 같은 규칙). 역치파워가 바뀌어도 과거 분포는 다시 계산하지 않는다 (LTHR 변경 때와 같다).
6. **역치파워 동기화는 LTHR 과 같은 패턴** — Garmin 자동 (`thresholdPowerSource = garmin`) · 수동 입력 (`manual`, 자동 싱크가 덮어쓰지 않음) · "Garmin 값으로 되돌리기". 변경은 `MetricChange` (`field = thresholdPower`) 이력.
7. 수동 입력 시 존 경계는 Garmin 실측 비율 (65 · 80 · 90 · 100 · 115%) 로 계산한다. 경계 직접 편집은 제외 (§7).
8. **강도 라벨 분류 규칙 (`classifyIntensity` 비율 임계) 은 기준과 무관하게 같다.** 보정 규칙만 기준별 — 심박: 평균 심박의 LTHR 존 ≥ 4 → `threshold` 이상 (현행). 파워: **정규화 파워 (`normPower`, 없으면 `avgPower`) ≥ 역치파워** (= 파워 Z4 이상) → `threshold` 이상. 임계 조정은 운영 관찰 뒤 별도 이슈.
9. **파워 기준은 러닝 계열에만** — 역치파워 · 파워 존이 Garmin RUNNING 프로필이므로 사이클 등은 설정과 무관하게 심박 기준 (PR #571 Codex P2 · `effectiveBasisSetting`).

## 3. 요구사항

### 570-1 · 백엔드 (PR 1)

**스키마 (migration 1 · `prisma-drift-fix` 절차가 필요하면 그 스킬)**
- [ ] S1 `UserProfile` 추가: `thresholdPower Int?` (W) · `thresholdPowerSource String?` (`manual` | `garmin`) · `thresholdPowerAutoDetected Boolean?` · `thresholdPowerMeasuredAt DateTime?` · `powerZonesRaw Json?` (Garmin RUNNING 항목 원본) · `intensityBasis String @default("hr")`
- [ ] S2 `Activity.intensityBasis String?` (`hr` | `power` · 강도 값이 없으면 null). 기존 행은 migration 에서 `zoneDistribution IS NOT NULL` → `'hr'`
- [ ] S3 raw SQL CHECK 제약: `UserProfile_thresholdPowerSource_check` (`IS NULL OR IN ('manual','garmin')`) · `UserProfile_intensityBasis_check` (`IN ('hr','power','auto')`) · `Activity_intensityBasis_check` (`IS NULL OR IN ('hr','power')`) — memory `project-source-check-constraints`
- [ ] S4 `MetricField` 에 `thresholdPower` 추가 — `profile-history.ts` · `mcp/server.ts` `get_metric_history` zod enum · `mcp/tools/user-profile.ts` `FIELD_LABELS` (`MetricChange.field` 는 CHECK 없음)

**Garmin 싱크 (`src/lib/garmin/fetchers/user-profile.ts`)**
- [ ] G1 `powerZones/sports/all` 조회 → `sport === "RUNNING"` 항목 선택 (순수 함수 `pickRunningPowerZones` · 외부 JSON 형태 검증, 다르면 null). `powerZonesRaw` 는 매 싱크 갱신 (수동 보호와 무관 — `heartRateZonesRaw` 와 같다)
- [ ] G2 `thresholdPower` = RUNNING `functionalThresholdPower`. `canAutoUpdate(thresholdPowerSource)` 일 때만 갱신 · 바뀌면 `MetricChange` (`garmin_initial` / `garmin_auto_detect`)
- [ ] G3 `latestFunctionalThresholdPower/RUNNING` → `thresholdPowerMeasuredAt` (`calendarDate` 는 naive 로컬 — KST 로 해석, memory `project-garmin-api-naive-tz`). user-settings `ftpAutoDetected` → `thresholdPowerAutoDetected`
- [ ] G4 파워 엔드포인트 실패는 `console.warn` 만 — `errors` 에 넣지 않는다 (넣으면 프로필 싱크 전체가 실패로 기록되고 weekly-report 가 activities 갭 필을 건너뛴다 · 사전 리뷰 major 1). 파워 엔드포인트 실패 · 빈 페이로드 · RUNNING 없음 = 파워 필드 미갱신 (기존 값 유지 · null 로 덮지 않음)
- [ ] G5 범위 검증: 역치파워 50~1000 W 밖이면 무시 + `console.warn`. 존 하한은 오름차순이어야 함

**강도 계산 (`src/lib/fitness/intensity.ts` · 순수)**
- [ ] I1 `extractPowerZoneDistribution(rawData)` — `powerTimeInZone_1~5`, 총합 `MIN_ZONE_TOTAL_SEC` 이하면 null (심박과 같은 규칙)
- [ ] I2 `computeIntensityFromRawData({ rawData, avgHR, lthr, basis, thresholdPower })` → 결과에 `basis: "hr" | "power"` 포함. `power` = 파워 분포 (없으면 null — 심박으로 대체하지 않음), `auto` = 파워 분포 있으면 파워 · 없으면 심박, `hr` = 현행
- [ ] I3 파워 보정 규칙 (§2-8) — `normPower ?? avgPower` ≥ `thresholdPower` 이고 라벨이 `easy`/`tempo` 면 `threshold`. 역치파워가 없으면 보정 생략 (LTHR 없을 때와 같다)
- [ ] I4 `power` 기준인데 파워 데이터가 없는 활동 → 강도 null + `intensityBasis` null (강도 없음으로 표시). 기존 값은 재계산 경로에서 비운다 (기준 혼재 방지 — 싱크 update 의 "null 이면 유지" 규칙은 **같은 기준일 때만**)
- [ ] I5 파워 존 경계 계산 `getPowerZoneRanges(thresholdPower)` (65/80/90/100/115%) · `garminPowerZoneRanges(raw)` (`src/lib/fitness/power-zones.ts` 신설 — `zones.ts` 와 대칭)

**싱크 · 재계산 경로**
- [ ] P1 `fetchers/activities.ts` — 프로필에서 `lthr` 와 함께 `intensityBasis` · `thresholdPower` 1회 조회 → 계산 → `intensityBasis` 컬럼 함께 저장
- [ ] P2 `src/lib/fitness/recompute-intensity.ts` — 전체 활동을 현재 설정으로 재계산 (rawData 만 · 배치 update · 같은 프로세스 안 직렬화). 변경된 행 수 반환. `scripts/backfill-intensity.ts` 는 이 함수를 쓰도록 교체 — 바뀐 행만 갱신하므로 반복 실행해도 안전하고, 이전 `--force` 는 이 동작에 포함됐다 (구현 중 변경)
- [ ] P3 `PATCH /api/profile` — `intensityBasis` (zod enum) · `thresholdPower` (50~1000 정수 · `null` 허용) · `revertToGarmin` enum 에 `thresholdPower` 추가 (`max(3)`). `intensityBasis` 가 실제로 바뀌면 같은 요청에서 P2 재계산 실행 · 응답에 `recomputed: N`. 실패 후 재시도는 `recomputeIntensity: true` (기준이 이미 저장돼 값 변경으로는 다시 돌지 않는다 · 사전 리뷰 major 2). 재계산 실패는 설정 저장을 되돌리지 않고 `{ error }` 대신 `recomputeError` 로 알린다 (설정은 이미 저장 — 다음 싱크/수동 재계산으로 복구)
- [ ] P4 동시성: 재계산 중 다른 재계산 요청 (설정 연타) 은 마지막 설정으로 다시 돈다 — 재계산은 실행 시점에 프로필을 다시 읽는다 (idempotent)

**MCP · AI 컨텍스트**
- [ ] M1 `get_user_profile` 에 `thresholdPower: { value, source, autoDetected, measuredAt } | null` · `powerZones: ZoneRange[] (W) | null` · `powerZoneSource: "garmin" | "calculated" | null` · `intensityBasis` 추가. Garmin 존은 `thresholdPowerSource = garmin` 이고 원본 FTP 가 현재 값과 같을 때만 (심박 존 규칙과 같다)
- [ ] M2 `get_activities` — 활동별 `intensityBasis`. `runningSummary` 에 기준 구성 (`basisCounts: { hr, power }`) — 80/20 해석 시 기준이 섞였는지 알 수 있게. 활동별 파워 값 (`avgPower` · `normPower`) 은 `rawData` 에만 있어 목록 조회 전체가 원본 JSON 을 읽게 되므로 **제외** (구현 중 변경 — 활동 단위 파워는 `get_activity_context` 의 기존 파워 줄)
- [ ] M3 `get_activity_context` · 운동 평가 섹션 (`activity-eval/sections.ts` `intensityLines`) — "강도 기준" 줄 · 파워 기준이면 존 이름을 파워 존 이름으로 (역치 W 값은 시스템 프롬프트 파워 존 표가 준다)
- [ ] M4 `system-prompt.ts` 동적 프로필 섹션 — 강도 기준 줄 + 파워 존 표 (W) 를 심박 존 표 옆에. 기준이 `power`/`auto` 면 "강도 판단은 파워 기준 우선 · 심박은 참고" 문장. **프롬프트 버전 본문 (DB) 은 건드리지 않는다** — 동적 섹션은 코드가 붙이는 부분 (#552 §3)
- [ ] M5 코드 기본값 프롬프트 (`prompts/defaults/*.ts`) 중 "개인 HR zone 으로 판단" 처럼 **심박을 유일 기준으로 못 박은 문구**만 "프로필의 강도 기준 (심박 또는 파워) 으로" 로 고친다. 고치면 R2 로 새 `code_default` 버전이 자동 추가된다 (웹 수정본이면 초안) — 변경 범위를 PR 에 명시

### 570-2 · UI (PR 2 · 디자인 시안 먼저 `docs/designs/570-running-power-intensity/`)

- [ ] U1 `/settings/profile` — "러닝 파워" 카드: 역치파워 입력 (W) · Garmin 값 · 출처 · 감지 시각 · "Garmin 값으로 되돌리기" (기존 `GarminSyncSection` 패턴) · 파워 존 표 (Z1~Z5 W)
- [ ] U2 같은 화면 "강도 평가 기준" 선택 (심박 / 파워 / 자동) + 설명 한 줄씩. 바꾸면 "전체 활동 N건 재계산" 결과 토스트. 파워 기준인데 역치파워가 없으면 경고 문구 (분포는 계산되지만 보정 규칙 생략)
- [ ] U3 활동 상세 `IntensityBreakdown` — 기준 배지 ("심박 기준" / "파워 기준") · 파워 기준이면 존 막대 라벨을 W 경계로. 비교 표의 라벨 옆 기준 표시
- [ ] U4 인사이트 존 분포 문구 "심박 존 1~5" → 기준에 맞게 ("강도 존 1~5 · 파워 N건 · 심박 M건")
- [ ] U5 `RunningAnalysis` "HR존 분포" 카드는 **평균 심박 기반 카드라 그대로** 둔다 (명칭이 이미 심박)

## 4. 기술 설계

```
Garmin ──(06:00 싱크 · user_profile 먼저)──▶ UserProfile.thresholdPower / powerZonesRaw / intensityBasis
                                                     │
Garmin activities ──▶ fetchers/activities.ts ──▶ computeIntensityFromRawData(basis, lthr, thresholdPower)
                                                     │        ├─ hr    : hrTimeInZone_*    + avgHR/LTHR 보정
                                                     │        └─ power : powerTimeInZone_* + NP/FTP 보정
                                                     ▼
                                     Activity { zoneDistribution, estimatedZone, intensityScore, intensityLabel, intensityBasis }
                                                     │  (읽는 쪽은 그대로 — 기준 표시만 추가)
PATCH /api/profile { intensityBasis } ──▶ recomputeAllIntensity() (rawData 만 · Garmin 호출 없음)
```

- **기준 혼재 방지**: 싱크 update 는 "새 계산이 null 이면 기존 값 유지" 규칙이 있다. 기존 행의 `intensityBasis` 가 새 기준과 다르면 null 로 비운다 (I4) — 그렇지 않으면 `power` 로 바꿨는데 파워 없는 활동이 심박 값을 그대로 들고 있게 된다.
- **재계산 규모**: 전체 활동 수백~천 건 · rawData 메모리 계산 + 변경된 행만 update. 요청 안에서 동기 처리 (Nginx 60초 안). 실측이 길면 `PromptRun` 같은 job 으로 바꾼다 (570-1 PR 에서 로컬 측정치 기록).
- **훈련 부하 이력**: `intensityScore` 가 기준에 따라 달라지므로 설정 변경 시 ACWR · 부하 이력도 바뀐다 — 의도 (기준 일관성). 설정 화면에 안내.

## 5. 변경 파일 (예상)

| 구분 | 파일 |
|---|---|
| 스키마 | `prisma/schema.prisma` · `prisma/migrations/<ts>_running_power_intensity/migration.sql` |
| 싱크 | `src/lib/garmin/fetchers/user-profile.ts` · `src/lib/garmin/fetchers/activities.ts` · (필요 시) `src/lib/garmin/profile-values.ts` |
| 계산 | `src/lib/fitness/intensity.ts` · `src/lib/fitness/power-zones.ts` (신설) · `src/lib/fitness/recompute-intensity.ts` (신설) · `src/lib/fitness/profile-history.ts` · `scripts/backfill-intensity.ts` |
| API | `src/app/api/profile/route.ts` |
| MCP | `src/mcp/tools/user-profile.ts` · `src/mcp/tools/fitness.ts` · `src/lib/fitness/running-window.ts` · `src/mcp/server.ts` |
| AI | `src/lib/ai/system-prompt.ts` · `src/lib/ai/activity-eval/{load,types,sections}.ts` · `src/lib/prompts/defaults/{system,activity-eval}.ts` (문구만) |
| UI (570-2) | `src/app/settings/profile/{page,profile-client,garmin-sync-section}.tsx` · `src/app/activities/[id]/{page,activity-detail-client}.tsx` · `src/app/insights/page.tsx` |

## 6. 테스트 계획 (vitest · `src/**/__tests__/**`)

- `intensity` — 기준별 분포 선택 (`hr` · `power` · `auto` × 파워 있음/없음) · 파워 보정 (NP ≥ FTP / NP 없고 avgPower / FTP 없음) · `power` 인데 파워 없음 → null
- `power-zones` — 비율 경계 (가상 FTP 300 W → 195 · 240 · 270 · 300 · 345) · Garmin 원본 변환 · 형태 불일치 → null
- `user-profile` 싱크 — RUNNING 선택 · 404/빈 배열/형태 불일치 시 미갱신 · `manual` 보호 · MetricChange 기록 · 범위 밖 무시 · `calendarDate` KST 해석
- `recompute-intensity` — 기준 변경 시 바뀐 행만 update · 기준 다른 기존 값 비우기 (I4)
- `/api/profile` — zod (기준 enum · FTP 범위 · revert 동시 변경 거부) · 기준 변경 시 재계산 호출 · 재계산 실패 시 설정 유지 + `recomputeError`
- `get_user_profile` · `get_activities` 출력 형태 (기준 · 파워 필드)
- 수동: 로컬 DB 에 migration 적용 → 설정 `power` → 활동 상세 · `get_activities` 확인. 서버 배포 후 06:00 싱크 뒤 프로필 역치파워 · 이브닝 리포트 강도 문구

## 7. 제외 사항

- 파워 존 경계 직접 편집 (Garmin 비율 고정 · 필요하면 후속)
- 약물 등 심박 영향 요인 자동 감지 · 자동 기준 전환 (수동 토글만)
- 심박 · 파워 두 기준 동시 저장 · 나란히 비교 화면
- 분류 임계 (`classifyIntensity` 비율) 의 파워 전용 튜닝 — 운영 관찰 후 별도 이슈
- 랩별 파워 차트 (`SplitChart` 의 미사용 `power` 시리즈) · 파워 기반 TSS 등 새 부하 지표
- 러닝 외 종목 파워 (사이클 FTP 등 — Garmin 은 내려주지만 범위 밖)
