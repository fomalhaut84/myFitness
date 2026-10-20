# [feat] 러닝 파워 역치 · 존 동기화 + 강도 평가 기준 선택 (심박 / 파워 / 자동)

- **작성일**: 2026-10-20
- **타입**: feat
- **이슈**: #570 (원 제안은 통합 프로젝트 쪽에서 — 서비스 저장소에서 진행하기로 결정)
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
| `Activity.rawData` | `powerTimeInZone_1~5` (초) · `avgPower` · `normPower` · `maxPower` 가 이미 저장돼 있다. **과거 활동도 재싱크 없이 파워 기준 값을 채울 수 있다** |

## 2. 결정 (2026-10-20 사용자 승인 — 1차 설계 "한 벌 저장 + 재계산" 을 대체)

1. **두 기준을 따로 저장하고 읽을 때 고른다 (덮어쓰기 없음).** 심박 기준 4개 컬럼 (`zoneDistribution` · `estimatedZone` · `intensityScore` · `intensityLabel`) 은 지금 그대로 · 옆에 **러닝 파워 기준 4개 컬럼** (`power*`). 프로필 기준을 바꿔도 저장 값은 바뀌지 않고 재계산도 없다 — 화면 · 리포트 · 부하 계산이 **읽는 쪽을 바꿀 뿐**. 되돌리면 원래 그대로.
2. **강도 기준 설정 = `hr` · `power` · `auto`** (UserProfile.intensityBasis · 기본 `hr` — 배포만으로 아무것도 바뀌지 않는다).
   - `hr` = 심박만.
   - `power` = **파워 우선, 파워 값이 없는 활동 (러닝 외 · 파워 없는 러닝) 은 심박** — 그 운동의 부하가 훈련 부하 · ACWR · 준비도 합계에서 빠지지 않게.
   - `auto` = **심박을 믿기 어려운 상황에만 파워**, 그 밖엔 심박 (심박 = 몸이 실제로 받은 부하라 믿을 수 있으면 더 정확). 상황 = ① **심박 영향 복약 기간** (복약 기록에 "심박에 영향" 표시 · 시작~종료일, KST 날짜) ② **더위** (활동 시작 시 체감온도 ≥ 28°C · Open-Meteo `weatherApparentTempC`). 심박 값이 없고 파워만 있으면 파워. 활동마다 **고른 이유** (`intensityBasisReason`) 가 남아 화면 · AI 가 설명한다.
3. **파워 기준 값은 러닝 계열에만** — 역치파워 · 파워 존이 Garmin RUNNING 프로필이므로 사이클 등은 null (PR #571 Codex P2).
4. **파워 분류 규칙은 심박과 다르다.** Garmin 러닝 파워 존 (역치 대비 65 · 80 · 90 · 100 · 115%) 은 Stryd 구간 — Z1 이지 · Z2 중강도 · Z3 역치 · Z4 인터벌 · Z5 반복으로 **심박 존 (Friel) 보다 의미가 한 칸 위**다. 심박 규칙을 그대로 쓰면 이지런이 `recovery`, 점수가 절반 가까이로 나왔다 (로컬 실측) → 기준을 바꾸는 순간 부하 · ACWR 눈금이 이력과 어긋난다.
   - 라벨: Z5 > 30% `max` · Z4+Z5 > 30% `interval` · Z3 > 30% `threshold` · Z2 > 30% `tempo` · 그 밖 `easy`. 보정: 정규화 파워 (없으면 평균) ≥ 역치 90% → easy/tempo 를 `threshold` · < 역치 65% → easy 를 `recovery`.
   - 점수: 존 가중치를 **심박 존 등가** (Z1→2 · Z2→3 · Z3→4 · Z4→5 · Z5→5) 로 — 같은 노력이면 심박 기준과 같은 눈금. 대표 존은 파워 존 번호 그대로.
5. **파워 존 분포는 Garmin 의 `powerTimeInZone_1~5` 그대로** (심박도 `hrTimeInZone` 그대로). 역치파워가 바뀌어도 과거 값은 다시 계산하지 않는다 (LTHR 변경과 같다).
6. **역치파워 동기화는 LTHR 과 같은 패턴** — Garmin 자동 · 수동 입력 (싱크가 덮어쓰지 않음) · "Garmin 자동으로" · `MetricChange(thresholdPower)`. 수동 입력 시 존 경계는 Garmin 비율로 계산.
7. **과거 활동 파워 값 채우기** — 싱크 끝 (activities · user_profile) 과 백필 스크립트가 비어 있는 러닝만 채운다. **역치파워가 생긴 뒤에만** (일일 싱크는 activities 가 user_profile 보다 먼저라, 배포 첫날 보정 없는 값이 굳지 않게).

## 3. 요구사항

### 570-1 · 백엔드 (PR 1 · #571)

**스키마 (migration 1 `20261020010000_running_power_intensity` · 컬럼 추가만)**
- [x] S1 `UserProfile`: `thresholdPower Int?` · `thresholdPowerSource` (`manual`|`garmin`) · `thresholdPowerAutoDetected` · `thresholdPowerMeasuredAt` · `powerZonesRaw Json?` · `intensityBasis String @default("hr")`
- [x] S2 `Activity`: `powerZoneDistribution Json?` · `powerEstimatedZone Int?` · `powerIntensityScore Float?` · `powerIntensityLabel String?` — 기존 심박 컬럼은 건드리지 않는다
- [x] S3 `Medication.affectsHeartRate Boolean @default(false)` — 자동 기준 판단 근거
- [x] S4 CHECK: `UserProfile_thresholdPowerSource_check` · `UserProfile_intensityBasis_check` (`hr`|`power`|`auto`)
- [x] S5 `MetricField` 에 `thresholdPower` (`profile-history.ts` · `get_metric_history` enum · `FIELD_LABELS`)

**Garmin 싱크**
- [x] G1 `powerZones/sports/all` → RUNNING (`parseRunningPowerZones`) · `powerZonesRaw` 매 싱크 갱신
- [x] G2 `thresholdPower` = RUNNING FTP — 수동이면 보호 · 바뀌면 `MetricChange`
- [x] G3 `latestFunctionalThresholdPower/RUNNING` `calendarDate` (naive → KST) · `ftpAutoDetected`
- [x] G4 파워 엔드포인트 실패는 `console.warn` 만 — `errors` 에 넣지 않는다 (넣으면 프로필 싱크 전체가 실패로 기록되고 weekly-report 가 activities 갭 필을 건너뛴다 · 사전 리뷰 major 1)
- [x] G5 범위 50~1000 W · 존 하한 오름차순

**계산 · 저장**
- [x] I1 `computeIntensityFromRawData` = 심박 (현행 그대로) · `computePowerIntensityFromRawData` = 러닝 파워 (§2-3 · §2-4 `classifyPowerIntensity`)
- [x] I2 `fetchers/activities.ts` — 두 기준을 함께 계산해 각자 컬럼에. 계산 불가면 update 에서 기존 값 유지 (M4-5 규칙 그대로)
- [x] I3 `fillMissingPowerIntensity` (§2-7) · `scripts/backfill-intensity.ts` (심박 백필 + 파워 채우기)

**읽기 (`src/lib/fitness/intensity-select.ts` · `intensity-setting.ts`)**
- [x] R1 `loadIntensityContext(db)` = 프로필 기준 + (auto 면) 심박 영향 복약 기간
- [x] R2 `selectIntensity` · `applyIntensityBasis` (심박 필드 자리에 고른 값 + `intensityBasis` · `intensityBasisReason`) · `selectIntensityLabel`
- [x] R3 읽는 곳 전부 적용: `get_activities` (+ `runningSummary.basisCounts`) · `get_training_load` · `get_injury_risk` · `get_readiness` · `get_weight_loss_status` · 운동 평가 (`activity-eval/load.ts` · 비교 라벨) · 활동 상세 · 같은 코스 · 인사이트 (`zoneBasis`) · 영양 (고강도 분)
- [x] R4 기준 변경 시 인사이트 캐시 무효화 (`bumpHistoryCacheVersion`)

**API · 복약**
- [x] P1 `PATCH /api/profile` — `thresholdPower` · `intensityBasis` · `revertToGarmin` 에 `thresholdPower`. 기준 변경은 설정 저장만 (재계산 없음)
- [x] P2 복약 입력 · DTO · 폼 모델에 `affectsHeartRate` — 수정 폼이 값을 왕복 (zod 기본 false 라 빠뜨리면 저장이 지운다)

**MCP · AI 컨텍스트**
- [x] M1 `get_user_profile` 역치파워 · 파워 존 · 기준 (+ 규칙 설명)
- [x] M2 `get_activities` 활동별 `intensityBasis` · `intensityBasisReason`. 활동별 파워 값 (`avgPower` · `normPower`) 은 rawData 에만 있어 **제외** (활동 단위 파워는 `get_activity_context` 의 기존 파워 줄)
- [x] M3 운동 평가 섹션 "강도 기준" 줄 (+ 고른 이유) · 파워 존 이름
- [x] M4 시스템 프롬프트 동적 섹션 — 기준 설명 + 파워 존 표 (프롬프트 버전 본문은 건드리지 않는다)
- [x] M5 코드 기본값 2곳 문구 (심박만 기준으로 못 박은 부분) — 배포 시 #552 R2 새 `code_default` 버전

### 570-2 · UI (PR 2 · 시안 `docs/designs/570-running-power-intensity/`)

- [x] U1 `/settings/profile` 러닝 파워 카드 — 역치파워 · 출처 · 감지 시각 · "Garmin 자동으로" · 존 자 (W)
- [x] U2 강도 평가 기준 카드 (심박 / 파워 / 자동 + 설명) — 바꾸면 바로 반영 (재계산 없음 · 되돌리면 원래대로)
- [x] U3 복약 폼 "심박에 영향" 체크 (+ 자동 기준과의 관계 한 줄)
- [x] U4 활동 상세 강도 분석 — 기준 배지 + 고른 이유 · 존 범위 (W / bpm) · **심박 · 파워 나란히 보기** (두 값이 다 있는 러닝)
- [x] U5 인사이트 "강도 존" 문구 + 기준별 건수 · 같은 코스 비교 표 라벨 옆 기준
- [x] U6 `RunningAnalysis` "HR존 분포" 카드는 평균 심박 기반이라 그대로

## 4. 기술 설계

```
Garmin ──(06:00 싱크)──▶ UserProfile.thresholdPower / powerZonesRaw          Medication.affectsHeartRate (사용자 표시)
                                                                                         │
Garmin activities ──▶ fetchers/activities.ts ─┬─ computeIntensityFromRawData      → zoneDistribution …   (심박)
                                              └─ computePowerIntensityFromRawData → powerZoneDistribution … (러닝 파워)
                                                                                         │
읽는 곳 ──▶ loadIntensityContext(db) { setting, hrAffectedPeriods } ──▶ applyIntensityBasis(row, ctx)
            → 심박 필드 자리에 고른 값 + intensityBasis + intensityBasisReason (하위 로직은 그대로)
```

- 자동 판단에 필요한 `startTime` · `weatherApparentTempC` 는 `StoredIntensity` 가 필수로 요구한다 — 빠뜨리면 타입 오류 (복약 · 더위 판단이 조용히 꺼지지 않게).
- 부하 이력: 기준을 바꾸면 **읽는 값** 이 바뀌므로 그래프는 새 기준으로 보인다. 점수 눈금은 §2-4 로 맞춰 두었다.

## 5. 테스트 계획 (vitest)

- `intensity` — 심박 · 파워 분포 분리 · 러닝 외 null · 파워 라벨/점수 규칙 (심박 Z2 이지와 같은 점수) · NP 보정 (90% · 65%)
- `intensity-select` — hr / power (폴백) / auto (복약 기간 경계 · KST 날짜 · 더위 경계 · 파워 없음 · 심박 없음) · `applyIntensityBasis` · `selectIntensityLabel`
- `power-zones` · `power-profile` · `power-payload` (엔드포인트 실패 비전파) · `power-section`
- `/api/profile` — zod · 되돌리기 충돌 · 기준 변경 = 설정만 + 캐시 무효화
- 복약 폼 왕복 (`affectsHeartRate`)
- 수동: 로컬 DB 백필 → 심박 값 불변 · 파워 값 채움 · 재실행 0건. 배포 후 06:00 싱크 → 역치파워 · 파워 값 채움 (`[파워] 대상 N개`)

## 6. 제외 사항

- 데이터 기반 자동 판단 (같은 파워 대비 심박 편차 — 기준값 드리프트 문제) — 운영 관찰 뒤 별도 이슈 (안 2)
- 파워 존 경계 직접 편집 · 러닝 외 종목 파워 · 파워 기반 TSS 등 새 부하 지표
- 랩별 파워 차트 (`SplitChart` 의 미사용 `power` 시리즈)
