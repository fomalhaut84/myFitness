# [M17 #1] 러닝 상세 AI 평가 — 상세 페이지 지표 전체를 근거로 분석

- **작성일**: 2026-09-23
- **타입**: feature
- **이슈**: #440 (P1)
- **브랜치**: `feat/440-1`
- **의존**: #418 (`loadActivityRecovery`) · #425 (`Activity.hrr2` · `median`) · #261 (`findSimilarActivities`) · #269 (기상 · 손목 온도). 스키마 변경 없음 · 패키지 추가 없음.
- **사용자 결정 (이슈 댓글 2026-09-23)**: 러닝 외 종목 확장은 이 이슈를 먼저 구현한 뒤 별도로. 이번 범위에서 러닝 외 종목은 **현행 요약 (기본 지표 · 3줄) 유지**.

## 1. 배경

활동 상세의 "🤖 AI 평가 요청" 은 클라이언트 (`activity-detail-client.tsx` `requestAiEval`) 가 이름 · 종목 · 거리 · 시간 · 평균/최대 HR · 유산소 TE · 케이던스 6개를 문자열로 이어 `/api/ai` 에 보내고 "3줄 이내" 로 제한한다. 상세 페이지가 보여주는 나머지 — km 스플릿 · 강도 분석 · 종료 후 회복 (#418) · 러닝 다이나믹스 · 추가 지표 · 환경 (#269) · 같은 코스 비교 (#261) — 는 평가에 들어가지 않는다. 사용자가 보는 것과 AI 가 보는 것이 다르다.

실코드 재검증 (2026-09-23):

| 지점 | 현황 |
|---|---|
| 세션 채널 | `channel: "web"` — `/ai` 채팅 페이지와 **같은 세션을 resume** 한다. 활동 평가 프롬프트가 채팅 맥락에 섞이고, 반대로 채팅 맥락이 평가에 섞인다 |
| 저장 | `/api/ai` 가 `AIAdvice` (`category: "exercise"`) 에 프롬프트 · 응답을 저장한다. 별도 이력 테이블은 없다 |
| 시스템 프롬프트 | "반드시 MCP 도구로 최신 데이터를 조회한 뒤 답변" — 컨텍스트를 서버가 넣어 주는 경우와 충돌하므로 프롬프트에서 명시적으로 덮어야 한다 |
| km 스플릿 | DB `splitSummaries` 는 RWD_RUN / INTERVAL_ACTIVE **요약**뿐이다. km 랩은 `activity-service/activity/{garminId}/splits` (Garmin API, `SplitChart` 가 온디맨드 호출) 에만 있다 → 평가 조립 시 **API 1회** |
| `Activity.rawData` 추가 키 (로컬 최신 러닝) | `activityTrainingLoad` · `trainingEffectLabel` · `aerobicTrainingEffectMessage` · `avgPower` / `normPower` / `maxPower` · `vO2MaxValue` · `movingDuration` / `elapsedDuration` · `avgVerticalRatio` · `avgGroundContactBalance` · `fastestSplit_1000` · `differenceBodyBattery` · `minTemperature` / `maxTemperature` |
| 이슈에 적힌 **GAP · performanceCondition** | rawData 에 **없다**. `recoveryTime` 은 프로덕션 0 / 2,157 (418 스펙) → 셋 다 제외 |
| MCP 도구 | `get_activity_splits(activityId)` · `get_activities` 등 read-only 22개. 같은 코스 매칭 (`findSimilarActivities`) 과 연도 중앙값은 **도구로 조회할 수 없다** |
| `askAdvisor` | sonnet · `--max-turns 15` · 180s 타임아웃 · `minTurns` 미달 시 재시도 (최대 3회). Nginx `proxy_read_timeout 300s` |

## 2. 목표

1. 러닝 상세의 AI 평가가 **페이지에 보이는 모든 섹션**을 근거로 한다. 결측 섹션은 조용히 빠진다 ("없다" 고 말하지 않는다).
2. 컨텍스트 조립은 서버 **순수 함수** (`buildEvalContext`) + vitest. 클라이언트는 `activityId` 만 보낸다.
3. 출력은 섹션별 한 줄 + 종합. "3줄 이내" 해제. 결과 블록에 섹션 구분과 **어떤 근거가 들어갔는지**가 보인다.

## 3. 요구사항

**API · 로딩**
- [ ] F1 `POST /api/activities/[id]/evaluate` — body 없음. `id` 검증 → 활동 없으면 404. 러닝 계열 (`isRunningType`) 이면 전체 모드, 아니면 **요약 모드** (기본 지표 섹션만 · "3줄 이내" — 현행 유지). 응답 `{ result, sections: string[], omitted: string[], duration_ms }` · 실패 `{ error }`.
- [ ] F2 `loadActivityEvalInput(id)` (prisma · Garmin) — 병렬 조회:
  - 활동 행 전체 컬럼 + `rawData` (서버에서만 읽고 클라이언트로 흘리지 않는다)
  - 종료 후 회복: `loadActivityRecovery(id)` (#418 그대로)
  - 같은 코스: `findSimilarActivities(id, { limit: 10 })` (#261 그대로)
  - 비슷한 거리 최근 기록: 러닝 · 거리 ±10% · 활동 시작일 기준 **직전 365일** · 최근 10건 · 같은 코스에 이미 있는 id 제외
  - 개인 기준선: 같은 해 러닝의 `hrr2` 중앙값 (`recoveryByYear` 재사용, 5건 미만 null) · 거리 버킷 (`bucketOf`) 이 잡히면 그 버킷 **전 기간 최저 페이스** 1건 (개인 기록)
  - km 스플릿: Garmin API (`fetchActivitySplits(garminId)` — 기존 `/splits` route 와 공용으로 추출). **실패하면 섹션 생략 + `omitted: ["splits"]`** (평가 자체는 진행)
- [ ] F3 `buildEvalContext(input)` **순수** → `{ sections: EvalSection[], prompt: string, mode: "full" | "brief" }`. `EvalSection = { id, title, lines: string[] }`. 값이 null 인 항목은 **줄 자체를 생략**, 줄이 0개인 섹션은 **섹션 생략**. 프롬프트에 `없음` · `null` 문자열이 들어가지 않는다.

**섹션 (전체 모드 · 상세 페이지 순서)**
- [ ] F4 `basic` 기본 지표 — 이름 · 종목 · 일시 (KST) · 거리 km · 시간 · 평균 페이스 · 고도 상승 · 칼로리 · 평균/최대 HR · 케이던스 · 이동 시간 vs 총 시간 (정지 시간 = `duration − movingDuration`, 1분 이상일 때만)
- [ ] F5 `splits` km 스플릿 — 900~1,100m 랩만 (`SplitChart` 규칙). 표 (`km · 페이스 · 평균 HR · 케이던스 · 고도`) 최대 60행, 넘으면 5km 묶음 평균. **파생값** (`summarizeLaps`, 순수): 가장 빠른/느린 km · 첫 km vs 전체 평균 페이스 차 (오버페이스) · 전반 vs 후반 평균 페이스 (positive / negative split, 초/km) · 페이스 변동계수 · 전반 vs 후반 평균 HR (심박 드리프트)
- [ ] F6 `intensity` 강도 분석 — 존 1~5 시간 · 비율 · 강도 라벨 · 점수 · 추정 존. 개인 존 경계는 시스템 프롬프트에 이미 있다 (중복 삽입 안 함)
- [ ] F7 `recovery` 종료 후 회복 — 오프셋별 bpm (−4 … +10, 결측은 줄 생략) · 2분 HRR · 10분 낙차 · **올해 중앙값 대비** (있을 때만) · "2분 해상도" 주석. `hasRecord=false` 또는 종료 후 유효 점 2개 미만이면 섹션 생략
- [ ] F8 `dynamics` 러닝 다이나믹스 — 케이던스 · 보폭 · 수직 진동 · 지면접촉시간 · (rawData) 수직 비율 · 좌우 균형
- [ ] F9 `extra` 추가 지표 — 유산소/무산소 TE + Garmin 라벨 (`trainingEffectLabel`) · 트레이닝 로드 · 평균/정규화 파워 · VO2max 추정 · 평균 호흡수 · 바디배터리 변화 · 랩 수 · 최고 1km (`fastestSplit_1000`)
- [ ] F10 `environment` 환경 — 기상 (Open-Meteo: 기온 · 체감 · 습도 · 바람 · 강수 · 상태) 과 **손목 온도는 별도 줄** (memory `project_weather_wrist_separation`)
- [ ] F11 `comparison` 비교 — (a) 같은 코스 최근 N건: 평균 페이스 · HR 과 그 델타 (UI `SameCourseComparison` 과 같은 계산) + 최근 3건 표 (b) 비슷한 거리 최근 N건 (365일): 페이스 · HR · 케이던스 · HRR 중앙값과 델타 (c) 거리 버킷 개인 최고 페이스 (날짜). 셋 다 없으면 섹션 생략

**프롬프트 · 호출**
- [ ] F12 프롬프트 — 머리말: "아래는 서버가 DB 에서 조립한 이 활동의 **전체 지표**다. 추가 도구 조회 없이 이 데이터만으로 평가하라. 데이터에 없는 항목은 언급하지 말라." → 섹션 본문 → 출력 지시: 포함된 섹션마다 `### 제목` + 1~2문장, 마지막 `### 종합` 3~5문장 (잘한 점 · 개선점 · **다음 러닝 제안 한 줄**). 요약 모드는 현행 "3줄 이내".
- [ ] F13 `askAdvisor(prompt, { channel: "activity-eval", minTurns: 0 })` — 호출 직전 `resetSession("activity-eval")` (평가는 항상 새 세션 · 채팅 세션과 분리). `AIAdvice` 저장: `category: "activity_eval"` · `reportDate: 활동 KST 날짜` · `prompt: 조립된 프롬프트`.

**UI (`src/components/activity/AiEvalCard.tsx`, 활동 상세 맨 아래 — 기존 자리)**
- [ ] F14 상태 4개: 대기 (버튼) → 분석 중 (경과 초 · "보통 30~90초") → 결과 → 오류 (메시지 + 다시 시도). 결과 카드: 상단에 **근거 칩** (`sections` 의 제목 · `omitted` 는 "스플릿 조회 실패" 흐린 칩) · 본문은 마크다운 (`### ` 헤딩을 카드 안 소제목 스타일로) · 하단 "다시 평가" (같은 활동 재요청 · 결과 교체).
- [ ] F15 시안 `docs/designs/440-activity-ai-eval/` (결과 블록만 · 데스크톱/360) — **승인 후 구현**.

**문서 · 테스트**
- [ ] F16 vitest — §6.
- [ ] F17 `docs/roadmap.md` 마일스톤 17 · `docs/specs/M14-followup.md`.

## 4. 기술 설계

```
클라이언트 AiEvalCard ── POST /api/activities/[id]/evaluate ──▶ route.ts
                                                                 ├─ loadActivityEvalInput(id)      src/lib/ai/activity-eval/load.ts   (prisma · Garmin)
                                                                 │    ├─ activity (+rawData)
                                                                 │    ├─ loadActivityRecovery      (#418)
                                                                 │    ├─ findSimilarActivities     (#261)
                                                                 │    ├─ similar-distance 10건 · 연도 hrr2 중앙값 · 버킷 PR
                                                                 │    └─ fetchActivitySplits       src/lib/garmin/activity-splits.ts (route 와 공용)
                                                                 ├─ buildEvalContext(input)        src/lib/ai/activity-eval/build-context.ts (순수)
                                                                 │    └─ summarizeLaps(laps)       src/lib/ai/activity-eval/splits.ts (순수)
                                                                 ├─ resetSession + askAdvisor(channel "activity-eval", minTurns 0)
                                                                 └─ AIAdvice.create(category "activity_eval")
```

**입력 DTO (`types.ts`)** — 로더가 만들고 빌더가 읽는 직렬화 가능한 형태. `rawData` 는 로더가 필요한 키만 뽑아 (`extractRawExtras`, 순수) DTO 에 넣는다 — 빌더는 rawData 를 모른다.

**섹션 생략 규칙** — `lines` 가 비면 섹션을 빼고, 프롬프트의 출력 지시도 **포함된 섹션 제목만** 나열한다. 모델이 없는 섹션을 만들어 내지 않게 "목록에 없는 제목은 쓰지 말라" 를 넣는다.

**같은 코스 vs 비슷한 거리** — 같은 코스 (#261) 가 우선 신호. 비슷한 거리 집합에서 같은 코스 id 를 빼 두 표가 겹치지 않게 한다. 둘 다 "최근" 은 **활동 시작일 기준** (오래된 활동을 열어도 동시대 비교 — #261 Codex P1 규칙).

**MCP 경계 결정** — 프롬프트 우선. 이유: (1) 같은 코스 매칭 · 연도 중앙값 · 거리 버킷 PR 은 도구가 없다 (2) 도구 호출 라운드가 없어 30~60초 빨라지고 `minTurns` 재시도가 필요 없다 (3) 순수 함수라 테스트로 근거를 고정할 수 있다. 시스템 프롬프트의 "반드시 도구 조회" 는 F12 머리말이 덮는다. 도구는 막지 않는다 (`allowedTools` 그대로) — 모델이 추가로 부르더라도 같은 값이다.

**Garmin API 실패** — `withReauth` 예외 → `omitted: ["splits"]` 로 평가는 계속. 재인증 실패 · 레이트리밋도 같은 경로 (로그는 `console.warn` 에 남긴다).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/ai/activity-eval/types.ts` · `load.ts` · `build-context.ts` · `splits.ts` · `raw-extras.ts` (+ `__tests__/`) | 신규 |
| `src/lib/garmin/activity-splits.ts` | 신규 — `/splits` route 의 Garmin 호출을 추출 |
| `src/app/api/activities/[id]/splits/route.ts` | 공용 함수 사용 |
| `src/app/api/activities/[id]/evaluate/route.ts` | 신규 |
| `src/components/activity/AiEvalCard.tsx` | 신규 (client) |
| `src/app/activities/[id]/activity-detail-client.tsx` | `requestAiEval` · 결과 블록 제거 → `AiEvalCard` |
| `docs/designs/440-activity-ai-eval/` · `docs/specs/440-activity-ai-eval.md` · `docs/roadmap.md` · `docs/specs/M14-followup.md` | 시안 · 문서 |

## 6. 테스트 계획

- `build-context.test.ts`: 전체 입력 → 섹션 9개 · 제목 순서 · 프롬프트에 `없음`/`null` 없음 / 회복 `hasRecord=false` → `recovery` 생략 / 스플릿 null → 생략 + 출력 지시에 제목 없음 / 비교 셋 다 없음 → 생략 / 러닝 외 → `mode: "brief"` · `basic` 만 / 손목 온도와 기상이 다른 줄 / 정지 시간 1분 미만 생략
- `splits.test.ts`: 900~1,100m 필터 · 가장 빠른/느린 km · 첫 km 오버페이스 부호 · positive/negative split · 변동계수 · HR 드리프트 · 61행 → 5km 묶음 · 랩 0개 → null
- `raw-extras.test.ts`: 키 결측 · 문자열 숫자 · 0 처리
- 4종 검증 · 로컬 `next dev` (`localhost`) 로 04-05 트랙 러닝 실평가 1회 (스플릿 API 는 로컬 Garmin 세션 필요 — 없으면 `omitted` 경로 확인)

## 7. 제외 사항

- 평가 결과 이력 · 이전 평가 다시 보기 (`AIAdvice` 에는 남는다 — 조회 UI 는 별도 이슈)
- 러닝 외 종목의 전체 모드 (사용자 결정: 이 이슈 뒤 별도)
- 수면 상세의 같은 문제 (`sleep-detail-client.tsx` 도 클라이언트 문자열 조립) — 후속 이슈 후보
- GAP · performanceCondition · recoveryTime — 데이터 없음
- 스트리밍 응답 — `askAdvisor` 가 JSON 일괄이라 범위 밖
