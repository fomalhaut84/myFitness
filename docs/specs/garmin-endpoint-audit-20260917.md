# Garmin 엔드포인트 감사 — 외부 MCP 2종 대비 (2026-09-17)

- **대상**: [Taxuspt/garmin_mcp](https://github.com/Taxuspt/garmin_mcp) (Python · python-garminconnect 0.3.2 · 110+ 도구) · [Nicolasvegam/garmin-connect-mcp](https://github.com/Nicolasvegam/garmin-connect-mcp) (TS · 61 도구)
- **방법**: 두 저장소를 clone 해 에이전트 2개가 병렬 감사 → 버그 지적은 본 세션에서 실코드로 재검증 (✅ 표기)
- **결론**: 둘 다 DB 없는 라이브 passthrough. 우리 구조(DB 캐시 + 파생 분석)는 유지. 가져올 것은 **엔드포인트 목록**과 **인증/복원력 디테일**.

## A. 우리 쪽 오해·버그 (재검증 완료)

| # | 내용 | 위치 | 심각도 | 조치 |
|---|---|---|---|---|
| A1 ✅ | 라이브러리 경유 호출(`getSleepData`/`getHeartRate`)은 `Date` 를 **서버 로컬 TZ** 로 문자열화 (`@flow-js/garmin-connect` `DateUtils.toDateString` = `getTimezoneOffset()`). 우리는 KST 자정 instant 를 넘기므로 호스트가 UTC 면 하루 전 날짜를 요청. 심박은 요청일 기준 라벨이라 데이터가 하루 어긋남 | `fetchers/sleep.ts:17`, `fetchers/heart-rate.ts:16` | 중 (현재 호스트 KST 라 잠복) | **#365 에 대상 추가** — `formatDate()` 문자열로 `client.get` 직접 호출 (daily-summary 방식) |
| A2 ✅ | HRV 를 심박 싱크가 매일 `getSleepData` 를 **한 번 더** 호출해 얻음 (rate limit 미적용, sleep.ts 와 중복). `hrvBaseline` 은 항상 null | `heart-rate.ts:26-38`, `schema.prisma:196` | 중 | `/hrv-service/hrv/{date}` 로 교체 → `lastNightAvg/weeklyAvg/baseline{balancedLow,balancedUpper}/status` 저장. readiness·injury 의 자체 7일 평균을 Garmin baseline 밴드로 보강 |
| A3 ✅ | `withRateLimit` 누락 | `body-composition.ts:46`, `heart-rate.ts:26` | 하 | 감싸기 |
| A4 ✅ | `avgPace` 분모가 경과시간 `duration`. payload 에 `movingDuration` 존재. 신호 대기 포함 러닝의 페이스가 느려지고 Riegel 예측 입력에 영향 | `activities.ts:68-71` | 중 | 결정 필요: Garmin 앱 "평균 페이스" 는 경과 기준이라 **현행 유지 + `movingPace` 컬럼 추가** 권장 (rawData 백필) |
| A5 ✅ | `get_activity_splits` 가 매 호출 Garmin **라이브 호출** — "MCP 는 DB 위" 원칙 위반, Garmin 장애 시 AI 도구 실패 | `api/activities/[id]/splits/route.ts:24-27` | 중 | 러닝 활동 싱크 시 `lapDTOs` 를 `Activity.laps Json` 에 저장 (또는 첫 호출 lazy 캐시) |
| A6 ✅ | 429 를 구분하지 않음 → dataType 통째 실패 후 다음 타입 계속 호출 (429 악화). `client.get` 타임아웃 없음 → stall 하나가 `syncAll` 전체 정지 (외부는 90초 타임아웃 · 지수 백오프 1→2→4s) | `client.ts:64-87`, `utils.ts:107-113` | 중 (4.5시간 backfill 에서 특히) | `withRateLimit` 에 429/5xx 백오프 + `AbortSignal.timeout(90s)`; 429 시 남은 dataType 중단 |
| A7 ✅ | 토큰: 갱신된 OAuth2 가 디스크에 안 남음 (`exportTokenToFile` 은 password 로그인 때만). `.garmin-tokens` 권한 755 | `client.ts:48`, 서버 확인 필요 | 하 | 성공 호출 후 export · dir 700/file 600 |
| A8 ✅ | 활동 목록을 `start/limit=20` 최신순 순회 후 startDate 미만에서 break. 같은 엔드포인트가 `startDate/endDate/limit≤200` 지원 → 초기/backfill 호출 수 5~10배 절감 가능 | `activities.ts:9,26-46` | 하 | backfill 전에 적용하면 이득 (결과 동일) |
| A9 | `startTimeLocal` 을 무조건 `+09:00` 가정 (해외 러닝 오라벨) | `activities.ts:39-41` | 하 | payload `timeZoneId` 참조. 후순위 |
| A10 | `intensityMin = moderate + vigorous` 단순합. Garmin 주간 목표는 vigorous ×2 | `daily-summary.ts:34-39` | 하 | 컬럼 의미 주석 + 두 값 분리 저장 |
| A11 | `privacyProtected===true` 응답(토큰 이상) 을 정상 stub 으로 저장 가능 | `daily-summary.ts:28` | 하 | 인증 실패로 분류 |

## B. 차이 없음 (확인)

daily summary · heart rate · weight(우리가 #328 exclusive endDate 까지 더 정확) · blood pressure · profile/zones(우리가 `heartRateZones` 까지 더 완전). Sleep 은 외부가 `wellness-service/.../dailySleepData?nonSleepBufferMinutes=60` 를 쓰고 우리는 `sleep-service` 경로지만 응답 shape 동일. **외부 두 프로젝트 모두 sleep SpO2 를 `averageSpo2` 로 읽는데 이는 #338 에서 우리가 고친 casing 버그와 같다 — 우리 쪽이 맞다.**

## C. 우리에게 없는 데이터 소스 (러닝 어드바이저 관점)

| 엔드포인트 | 반환 | 히스토리 | 가치 |
|---|---|---|---|
| `hrv-service/hrv/{date}` | lastNightAvg, weeklyAvg, baseline 밴드, status, feedbackPhrase | 일별 1콜 | A2 해결 + readiness/injury 근거 |
| `metrics-service/metrics/trainingreadiness/{date}` | score/level + sleep/recovery/acwr/hrv factor %, recoveryTime (`inputContext=AFTER_WAKEUP_RESET` 가 모닝값) | 일별 1콜 | `get_readiness_score`(bodyBattery 기반) 교차검증 |
| `metrics-service/metrics/trainingstatus/aggregated/{date}` | trainingStatus, ATL/CTL/**ACWR**/acwrStatus, load focus(aerobic low/high/anaerobic), mostRecentVO2Max | 일별 1콜 (외부 90일 cap) | 자체 ACWR 정본 대조 |
| `metrics-service/metrics/racepredictions/{daily\|monthly}/{displayName}?fromCalendarDate&toCalendarDate` · `/latest/{displayName}` | 5K/10K/HM/FM 예상 초 | **범위 1콜 ≤366일** | Riegel 자체 예측과 병기. `displayName` 은 `getUserProfile()` 에 있음 |
| `metrics-service/metrics/endurancescore/stats?…aggregation=weekly` · `hillscore/stats` | 지구력/힐 점수, 등급 | 범위 1콜 | 장기 추세 |
| `metrics-service/metrics/runningtolerance/stats?startDate&endDate&aggregation=weekly` | 러닝 부하 허용량, impact load | 범위 1콜 (신형 기기) | 부상 위험 보강 |
| `personalrecord-service/personalrecord/prs/{displayName}` | 거리별 PR | 스냅샷 | 목표 진척 |
| `fitnessage-service/fitnessage/{date}` | fitnessAge + 구성요소 | 일별 | 감량 리포트 보조 (최하) |
| `wellness-service/wellness/bodyBattery/reports/daily?startDate&endDate` · `userstats-service/wellness/daily/{displayName}?metricId=60` | BB·RHR 범위 조회 | **범위 1콜** | 일별 루프(2초/일) 대체 → backfill 시간 단축 |
| `activity-service/activity/{id}/weather` · `/hrTimeInZones` · `/typedsplits` | 활동 기상·HR존·인터벌 랩 | 활동별 | 기상은 Open-Meteo 폴백 구조로 |
| (기존 `maxmet` 응답 안) `heatAltitudeAcclimation` | 열/고도 순응 % | 이미 수신 | #378 rawData 보존 → 여름 레이스 |

Activity list 응답에 있으나 컬럼 없음(rawData 에는 있음): `eventType.typeKey`(race/training), `movingDuration`, `activityTrainingLoad`, `trainingEffectLabel`, `avgGradeAdjustedSpeed`, `averagePower/normalizedPower`, `recoveryTime`, `performanceCondition`. DailySummary: `bmrKilocalories`(칼로리 밸런스 정확도), `lastSevenDaysAvgRestingHeartRate`, `min/maxHeartRate`, `maxStressLevel`. Sleep: `awakeCount`, `restlessMomentsCount`, `napTimeSeconds`.

## D. 도입 후보 (우선순위 · 효과/비용)

| 순위 | 항목 | 규모 | 근거 |
|---|---|---|---|
| 1 | **HRV 서비스 싱크 + A2/A3 정리** | S | 버그 제거 + injury/readiness 정확도 직결 |
| 2 | **복원력: 429 백오프 · 타임아웃 · 토큰 export/권한 (A6·A7)** | S | #377 backfill(4.5h) 전에 있어야 안전 |
| 3 | **활동 싱크 `startDate/endDate/limit` (A8)** | S | backfill 비용 절감, 결과 동일 |
| 4 | **Activity 컬럼 승격** (`eventType`, `movingDuration`, `activityTrainingLoad`, `trainingEffectLabel`, GAP) — rawData 백필, API 호출 0 | S | race 태그로 페이스 진척/PR 정확도 · A4 |
| 5 | **Training readiness + status 일별 스냅샷** (신규 모델) | M | Garmin 공식 ACWR/readiness 를 자체 값과 나란히 |
| 6 | **Race prediction 이력** (범위 1콜) | S | `get_race_prediction` 에 `garmin` 시나리오 |
| 7 | **Splits DB 캐시 (A5)** | M | 아키텍처 정합 |
| 8 | Endurance/Hill/Running tolerance 주간 · PR 스냅샷 · fitness age | S~M | 후순위 |
| 9 | A1 → #365, A9~A11 | S | 정리성 |

## E. 참고 구현 디테일

- 토큰: JWT `exp` 임박 시 선제 refresh, 401 → refresh 1회 재시도, 갱신 즉시 파일 저장, 파일 600. 우리 `authenticate()` 는 토큰 파일 → `getUserProfile()` 프로브 → 실패 시 password. password 경로가 Cloudflare 429 에 가장 취약.
- MFA: 대화형 1회 `setup` CLI 로 토큰만 저장, cron 은 토큰만 로드. Garmin 이 MFA 를 강제하면 지금 구조는 cron 이 조용히 실패 — 사전 대비 가치 있음 (`@flow-js/garmin-connect` MFA 지원 여부 확인 필요).
- 도구 설명: "오늘 데이터는 06:00 싱크 전엔 어제까지" 지연 힌트 + 형제 도구 안내 문구.
- 범위 청킹 헬퍼(28일/366일 cap) — #378 F2 와 동일 패턴.
- **복사 금지**: 일별 루프의 `.catch(() => null)` (인증 실패까지 삼킴), 원본 payload 전량 통과, 중복 도구.

## F. #377 · #378 반영

- #377 backfill 은 D-2(복원력) 없이도 청크 재시도로 동작하지만, 4.5시간 실행이므로 **D-2 를 #377 직후 우선 처리** 권장. D-3 은 backfill 이전이면 이득.
- #378 은 C 의 `heatAltitudeAcclimation` 을 rawData 로 보존 (이미 스펙 §6).
- 후속 이슈 후보: D-1 (HRV), D-2 (복원력), D-3+D-4 (활동 싱크/컬럼), D-5 (training daily), D-6 (race prediction).
