# M14 후속 백로그 (Phase 4 이후)

> 세션 간 컨텍스트 인계 문서. M14 Phase 2 ~ Phase 4 릴리즈 이후 발견/유예된 후속 작업 목록.
> 신규 세션 진입 시 이 문서로 진행 상황 파악 → 개별 이슈 착수.
>
> **⚠️ 모든 항목은 착수 시 재검증 필수**. 이 문서의 스코프·주의사항은 작성 시점 관찰 기반이라 코드 변경/API 진화에 따라 stale 될 수 있음. 항목 착수 전에 반드시 해당 파일·라인 확인 · Codex 지적의 근거가 여전히 유효한지 실코드로 재검증.

## 현재 상태 (2026-09-24 오전, #444 Phase 1 구현 · PR 오픈)

**최근 릴리즈:** **v2.37.1** (변동 없음). dev 는 릴리즈와 동일. **#444 Phase 1 승인 (2026-09-24) → 구현 완료 → PR (dev)** — 머지 후 릴리즈 **v2.38.0** (feature · migration 없음).

### 인계 (다음 세션에서 이어갈 것)

| 항목 | 상태 | 비고 |
|---|---|---|
| **#444 리포트 근거 확장 Phase 1** (P2) | **PR 오픈 (dev)** — 사전 리뷰 → 봇 게이트 → 사용자 머지 | 스펙 `444-report-evidence.md` §8 구현 결과. 머지 후 v2.38.0 릴리즈. **배포 후 확인**: 첫 이브닝 리포트가 `get_activity_context` 를, 주간 리포트가 `days=27, endDate` 기준선을 실제로 호출하는지 (`pm2 logs` tool call 또는 `AIAdvice.prompt`) |
| **#455 Phase 2** (P2) | 신규 | A5 `get_personal_records` · A8 · A9 · A10 · A12. Phase 1 배포 후 리포트 결과를 보고 착수 |
| **#441 HRR 1분 해상도** (P2) | F2 워치 "매초" 실험 — 09-24 당일 행은 시계열이 아직 없어 빈 결과. **내일 06:00 cron 뒤** 최근 3일 쿼리 (이슈 댓글) 로 재확인 | 60초 다수면 §4 구현, 120초만이면 종료 |
| **#448 · #449 Codex P2 후속** | 여유 있을 때 | — |
| #437 · #414 · #419 · 독립 후속 | 이전 상태 표 그대로 | — |

**이번 세션 결과 (2026-09-24 오전):**
- **#444 Phase 1 구현** — `running-window.ts` (순수) · `get_activities` 필드 · `GET …/context` + MCP `get_activity_context` (`activity-id.ts` 공용) · `report-prompts.ts` (프롬프트 정본 분리 · 주간 endDate 를 생성 시점에 박음). vitest 288 → 310. 로컬 `next dev` + `tsx` 직접 호출로 도구 응답 확인. 사전 리뷰 critical 0 / major 0 / info 4 반영.
- Phase 2 이슈 #455 생성.

**세션 관찰:**
- Garmin 존 시간 (`hrTimeInZone_n`) 은 **소수 초** — 합계를 그대로 내보내면 `220.42299999999997` 같은 부동소수 잔재가 모델에 간다. 응답 경계에서 정수로.
- MCP 도구를 `tsx` 로 직접 호출할 때는 `.env` 를 셸에 export 해야 한다 (`src/mcp/prisma.ts` 는 dotenv 를 안 읽는다 — `server.ts` 만 읽음). `dotenv/config` 는 scratchpad 경로에서 resolve 안 됨.
- 리포트 프롬프트에 "오늘 − 7일" 같은 상대 날짜를 두면 모델이 산술을 한다 — 생성 시점에 구체 날짜를 박는 함수로.

---

## 이전 상태 (2026-09-24 새벽, v2.37.1 배포 · 세션 종료 — 다음 세션은 #444 Phase 1 승인부터)

**최근 릴리즈:** **v2.37.1** (릴리즈 PR #454 · merge commit · Deploy on Release success). main = v2.37.1. 이 문서의 아래 절은 v2.37.1 릴리즈 **준비** 시점 기록이라 "릴리즈 준비" 행은 완료로 읽는다.

### 다음 세션에서 이어갈 것

1. **#444 리포트 근거 확장 Phase 1** — 브랜치 `feat/444-1` (origin 에 push, 커밋 1: 스펙 초안의 직전 4주 창 `endDate` 반영). **기획 승인부터** — 스펙 `docs/specs/444-report-evidence.md` §3 F1~F11 을 사용자와 확정 (Phase 2 는 별도 이슈 생성). 승인 후 TDD: `summarizeRunningWindow` → `GET /api/activities/[id]/context` → MCP `get_activity_context` (HTTP 경유) → 프롬프트 3종 + 회귀 테스트 → allowlist · `verify-mcp-long-history [7]`.
2. #441 — 워치 "매초" 실험 결과 (이슈 댓글 두 번째 쿼리) 가 오면 스펙 §5 결론.
3. #448 · #449 Codex 후속 (P2) — 여유 있을 때.

**이번 세션 (2026-09-24) 결과:** #445 완료 (PR #452) → v2.37.1. Codex 는 PR #452 · 릴리즈 PR #454 에 미도착 (사전 리뷰가 완료 판정 · 릴리즈는 사용자 결정으로 머지). 문서 PR #453 은 봇 3라운드 (P2 · 종료 규칙) — 그중 "직전 4주 창이 이번 주와 겹침" 은 #444 초안에 반영.

---

## 이전 상태 (2026-09-24, v2.37.0 배포 · #445 머지 · v2.37.1 릴리즈 준비)

**최근 릴리즈:** **v2.37.0** (2026-09-23, 릴리즈 PR #451 · Deploy success · 배포 후 검증 완료 — AI 평가 16초 · turns=1 · 스플릿 성공). dev 에 **#445 (PR #452)** 머지 → 릴리즈 **v2.37.1** (patch · migration 없음) 준비. M17-1 · 3 · 4 완료, M17-2 (#441) 는 사용자 실험 대기.

### 인계 (다음 세션에서 이어갈 것)

| 항목 | 상태 | 비고 |
|---|---|---|
| **v2.37.1 릴리즈** (#445 · PR #452) | 문서 PR #453 → 릴리즈 PR **#454** (dev → main) → 봇 게이트 → 사용자 머지 (merge commit) → 태그 · Release | v2.37.0 은 **완료** (배포 · 검증 끝 — 위 "최근 릴리즈"). 배포 후 확인: `/history/2026/09` 헤더 `월…일` · 연간 카드 빈 칸 · `/lifestyle` 캘린더 (PR #454 검증 계획) |
| **#445 월별 그리드 월요일 시작** (P2) | **완료 (PR #452 머지 2026-09-24)** — 릴리즈는 위 행 | `month-cells.ts` 정본 · `MonthlyHeatmap` 로컬 TZ 제거. 봇 미도착 (사전 리뷰가 완료 판정). 다음: #444 Phase 1 기획 (스펙 **초안** `444-report-evidence.md` — 승인 전) |
| **#441 HRR 1분 해상도** (P2) | F1 기준값 완료 (전 월 60초 0건 · 2분 격자) · **F2 워치 "매초" 실험 대기** | 결과 나오면 스펙 §5 기록 → 소스 있으면 §4 구현, 없으면 종료 |
| **#444 리포트 근거 확장** (P2 → 범위 확대) | 신규 · **지표 전체 점검 완료** (이슈 댓글 2026-09-23: 누락 A1~A12 · 추가 분석 후보 · Phase 1/2 제안) | 사용자 댓글 요청. Phase 1: `get_activities` 에 hrr2 · 존 분포 · 모닝 혈압 · 플랜 준수 · `get_activity_context` · VO2max/LT — 기획 시 항목별 채택 확정 |
| **#448 · #449 Codex P2 후속** (P2) | 신규 (종료 규칙) | 448: 같은 코스 이전 기록을 매처 안으로 · 제외 집합 · 1km 라벨 / 449: 기간 비교 안내 문구 지표 방향 |
| #437 · #414 · #419 · 독립 후속 | 이전 상태 표 그대로 | — |

**이번 세션 결과 (2026-09-23 밤, 이어서):**
- **#442 완료 (PR #447)** — `median` 집계 · `hrr2` 지표 (sparse · 띠 · `coverageNoun`) · 시작일 캡션 (`data-start.ts`) · 개인 기록 `bestHrr2`. vitest 246 → 258 (dev 머지 후 두 PR 합산 288 예상 — 릴리즈 전 4종 검증에서 확인).
- Codex 종료 규칙 2회 적용 (PR #446 2회차 → #448 · PR #447 2회차 → #449). 두 PR 모두 봇 P0/P1 0.
- #441 F1 프로덕션 기준값 (사용자 실행): 2026-04~09 전 월 60초 간격 0건.

**세션 관찰:**
- 같은 세션에서 PR 두 개를 병행할 때 리뷰 에이전트는 각자 detached worktree 를 쓰고 스스로 정리했다 (`worktree-agent-*` 잔여 없음). 메인 체크아웃의 브랜치 전환은 커밋이 전부 된 상태에서만.
- `npm run typecheck` 가 브랜치 전환 직후 `.next/types/validator.ts` 의 stale 라우트 참조로 실패할 수 있다 — `rm -rf .next` 또는 `npm run build` 뒤 재실행.
- Codex 는 수정 push 마다 새 엣지를 찾는다 (1회차 P2 반영 → 2회차 같은 주제의 더 깊은 엣지). 종료 규칙 2라운드가 실제로 작동했다.

---

## 이전 상태 (2026-09-23 밤, M17-1 PR #446 오픈 · #442 착수)

**최근 릴리즈:** **v2.36.1** (변동 없음). dev 는 문서 PR 만 앞섬. **M17 마일스톤 시작** — 세션 인계 후보 3건을 기획 (스펙 440 · 441 · 442) → 사용자 승인 (2026-09-23).

### 인계 (다음 세션에서 이어갈 것)

| 항목 | 상태 | 비고 |
|---|---|---|
| **#440 러닝 상세 AI 평가** (P1) | **PR #446 오픈 (dev)** — 사전 리뷰 critical 0 / major 0 / info 6 반영 · 봇 리뷰 대기 | 머지 후 릴리즈 **v2.37.0** (feature). 스펙 `440-activity-ai-eval.md` · 시안 `docs/designs/440-activity-ai-eval/` |
| **#442 /trends HRR 지표** (P2) | 스펙 `442-trends-hrr-metric.md` 승인 · **착수** | `median` 집계 신설 · 시작일 캡션 · 개인 기록 "가장 큰 2분 HRR" · `hrrDrop10` 제외 |
| **#441 HRR 1분 해상도** (P2) | 조사 완료 · **사용자 실험 대기** (이슈 댓글의 쿼리 2개 — 기준값 · 워치 "매초" 설정 후 하루 뒤) | 60초 격자 나오면 스펙 §4 (격자 자동 감지 · `hrr1`), 아니면 결론 기록 후 종료. 보간 금지 |
| **#444 이브닝 리포트 · MCP `get_activity_context`** (P2) | 신규 (사용자 요청 — 리포트가 오늘 러닝을 활동 상세보다 얕게 봄) | #440 조립 함수를 도구로 노출. #440 뒤 |
| **#445 월별 그리드 월요일 시작** (P2) | 신규 (사용자 요청 2026-09-23) — `/history` 월 그리드 · 연간 카드 · `/lifestyle` 히트맵 · 대시보드 주간 차트 | #442 뒤 다음 스펙. 주간 버킷은 이미 월요일 |
| #437 · #414 · #419 · 독립 후속 | 이전 상태 표 그대로 | — |

**이번 세션 결과 (2026-09-23 밤):**
- **#440 구현** — `src/lib/ai/activity-eval/` 순수 조립 (섹션 8개 · 스플릿 파생값 · rawData 보조 지표 · 요약 모드) + `POST /api/activities/[id]/evaluate` (평가 전용 세션 채널 `activity-eval` 리셋 · Garmin 스플릿 공용 fetch · `AIAdvice` `activity_eval`) + `AiEvalCard`. vitest 246 → 275. 로컬 실평가 2회 (51초 · 섹션 7개) · CDP 실화면 캡처.
- 실데이터에서 잡힌 결함 3 → 회귀: ISO 문자열을 `formatEpochKST` 에 (`-`) · 파서 정정 이전 보폭 cm 혼재 (`7887cm`) · 모델의 `120~130bpm` 이 GFM 취소선.
- 사전 리뷰 info 6 전부 반영 (같은 코스 비교는 **이전** 기록만 · marked `del` 토크나이저 비활성 등).

**세션 관찰:**
- **리포트는 MCP 도구 호출 방식** (`minTurns: 2`), 활동 평가는 프롬프트 우선 — 두 경로가 같은 근거를 보려면 조립 함수를 도구로 노출해야 한다 (#444).
- `formatEpochKST` 는 ISO 문자열을 받지 않는다 (`Number("2026-…")` = NaN → `-`). ISO 는 `Date.parse` 먼저.
- Next route 파일은 핸들러 외 export 를 허용하지 않는다 — 채널/카테고리 상수는 lib 로.
- 브라우저 확장 미연결 시 CDP 스크립트 (`ws` 패키지 + `--remote-debugging-port`) 로 클릭 · 대기 · 클립 캡처 가능. 클립은 문서 절대 좌표 + `captureBeyondViewport: true`. macOS Chrome 창 최소 폭 ~500px — 360 캡처는 iframe 으로.
- 마일스톤 17 = #440 · #441 · #442 (로드맵).

---

## 이전 상태 (2026-09-23 밤, v2.36.1 배포 후 확인 · 보존 창 감사 완료 · 세션 종료)

**최근 릴리즈:** **v2.36.1** — 심박 · 수면 재싱크 덮어쓰기 가드 (#431 · #435, PR #433 · #436) + 패널 E 후속 (#429). 릴리즈 PR #434. main = `v2.36.1`, migration 없음. dev 는 문서 PR (#438 · #439 · 이 PR) 만 앞섬 — 런타임 동일, 릴리즈 대상 없음. **M16 마일스톤 (HRR) 완료** — M16-1 활동 상세 · M16-2 `/insights` 추이 · M16-3 가드.

### 인계 (다음 세션에서 이어갈 것)

**오픈 PR 없음. 다음 마일스톤 미정 — 세션 종료 시 사용자가 등록한 후보 3건 (#440 · #441 · #442) 이 최상단.** 후보:

| 후보 | 내용 | 비고 |
|---|---|---|
| **#440 러닝 상세 AI 평가 확장** (feature · **P1**) | 현재 `requestAiEval` 은 6개 지표 · "3줄 이내". 상세 페이지 전 섹션 (기본 · km 스플릿 · 강도 · 종료 후 회복 · 다이나믹스 · 추가 지표 · 환경 · 같은 코스/비슷한 기록 비교) 을 근거로 — 컨텍스트 조립을 서버 순수 함수로, MCP 도구 경계 결정 | UI 소규모. M17 후보 1순위 |
| **#441 HRR 1분 해상도** (chore · P2) | Garmin 일별 시계열은 120초 격자 (로컬 실측 3,416/3,420) — **1분 소스 조사가 먼저**. 없으면 스펙에 결론 기록 후 종료. 보간 금지 | 조사 결과에 따라 #442 와 순서 조정 |
| **#442 /trends HRR 지표** (feature · P2) | `metrics.ts` 에 `hrr2` (activity · sparse · 중앙값 집계) · 시작일 캡션 · records 포함 여부 | `Activity.hrr2` 승격돼 있어 비용 낮음 |
| **#437 가드 후속** (chore · P2) | `isPresent` 숫자 문자열 · trimmed 시 `sleepScoreDetails` spread 생략 (한 줄 ×2) — fetcher payload 조립을 순수 함수로 빼면 회귀 테스트 가능 | 작음 |
| #414 · #419 · D8 잔여 · 독립 후속 | 이전 상태 표 그대로 | — |

**완료 (2026-09-23 밤, 사용자 실행 · 431 스펙 §4 에 기록):**
- **배포 후 확인** — 14:11 KST 재기동 → 15:00 cron (21건 · 실패 0) 뒤 `heartRateValues` array 156 (04-20 ~ 09-22) · `hrvOvernight` 156 (04-20 ~) — 기준과 동일, 손실 없음.
- **보존 창 감사** — `DailySummary.rawData` 의 bodyBattery · stress 는 2020-06 ~ 2026-09 전 기간 존재 → **창 없음**, daily_stats 가드 불필요, 이슈 미생성. `fitness_metrics` 는 fetcher 병합으로 덮어쓰기 위험 없음.
- `fitness_metrics` 보존 창은 **미측정** (Codex P2 · PR #439) — 다음 `backfill:history --types=fitness_metrics` 전 `jsonb_typeof` 월별 분포 확인.
- 관찰: `SyncMetadata.lastSyncAt` 은 naive UTC (`timestamp(3)`) — psql 에서 KST 로 보려면 `("lastSyncAt" at time zone 'UTC') at time zone 'Asia/Seoul'` (단일 `at time zone` 은 UTC 값을 그대로 보여준다).

**이번 세션 결과 (2026-09-23 저녁):**
- **#431 · #435 완료 (v2.36.1)** — `preserve.ts` (`withoutNulls` · `isTrimmedResponse` 재귀 · `preserveUpdate`) · fetcher 2개 · `backfill:history --allow-old-wellness`. 사전 리뷰 major 1 (sleepLevels OR 조건이 덮어쓰기 재개) 반영. Codex 가 세 PR 에서 P2 5건 — 반영 2 (중첩 재귀 · #435 자체), #437 로 2, 게이트 통과.
- **#429 완료** (PR #433).
- Codex 종료 규칙 적용 3회 (PR #436 · 릴리즈 PR #434 ×2). 사용자 결정: 릴리즈 PR 의 P2 (#435) 는 fix PR 로 dev 에 먼저 반영 후 릴리즈 (선택지 2).

**세션 관찰:**
- **가드는 "특정 필드" 가 아니라 "소실 비교" 로** — Garmin 응답에서 무엇이 보존 창에 걸리는지 전부 알 수 없다 (sleepLevels 는 남고 HRV · SpO2 epochs 는 사라짐). 기존 값과의 재귀 비교가 필드 목록보다 안전하다.
- Codex 는 릴리즈 PR 에도 매 dev 갱신마다 새 라운드를 돈다 — 릴리즈 PR 에서 P2 가 나오면 "fix PR → dev → 자동 반영" 이 동작함 (release-flow Step 5). 단 라운드마다 새 엣지가 나오므로 종료 규칙을 릴리즈 PR 에도 적용.
- `gh issue edit --title` 로 후속 이슈를 확장해 이슈 수를 억제 (#437 에 2건 묶음).

---

## 이전 상태 (2026-09-23 오후, M16-2 HRR 추이 · v2.36.0 배포 시점)

**최근 릴리즈:** **v2.36.0** — `/insights` 연도별 HRR 추이 (#425, PR #428 · 릴리즈 PR #430 · migration `activity_hrr` additive). main = `v2.36.0`, 배포 success · 프로덕션 `backfill:hrr` 실행 완료 (갱신 111 / 2,157). dev 는 이 문서 PR 만 앞섬 — 런타임 동일.

**⚠️ 발견 (P1 · #431):** 프로덕션 심박 시계열 (`heartRateValues`) · 야간 HRV 가 **2026-04-20 이전 전부 null** — Garmin 이 일별 wellness 상세를 최근 ~150일만 주고, 09-17 `backfill:history` 가 그 밖의 날짜를 재조회하며 심박 · 수면 fetcher 의 무조건 upsert 가 기존 값을 null 로 덮어씀. 최초 싱크 (04-07) 때 있던 2025-11 ~ 2026-04-19 는 **복구 불가**. memory `project_hrv_data_start` 정정 · `project_garmin_wellness_retention` 신설. **#431 가드 전에는 `backfill:history --types=heart_rate,sleep` 금지.**

### 인계 (다음 세션에서 이어갈 것)

**오픈 PR 없음.** 다음 착수 (우선순위 순):

| 후보 | 내용 | 비고 |
|---|---|---|
| **#431 덮어쓰기 가드** (bug · **P1**) | fetcher: 응답 상세 null + 기존 행 값 있음 → 유지 (기존 행 select 1회 · `isEmptyHeartRate` 와 충돌 X) · `backfill:history` 보존 창 밖 wellness 경고/skip · 회귀 3케이스 · 다른 일별 타입 감사 | 재발 방지. 5개월 뒤 지금 데이터가 지워지지 않게. 에이전트 필수 경로 |
| **#429 패널 E 후속** (chore · P2) | `--dry-run` 이어가기 명령 · 연도 토글 시 중앙값 점 숨김 · **캡션 시작일** (`종료 후 심박은 2026-04 부터`, 데이터에서) | 한 줄 ×3. #431 과 같은 PR 로 묶어도 됨 |
| #414 · #419 · D8 잔여 · 독립 후속 | 이전 상태 표 그대로 | — |

**이번 세션 결과 (2026-09-23 오후):**
- **#425 완료 (v2.36.0, PR #428)** — `hrr2` · `hrrDrop10` 승격 · `fillRecoveryColumns` (청크 커서 · 일자별 레코드 1회 · 결측 null 유지 · `--after-id`) · `syncAll` 후처리 (창 −2일 · 캐시 bump) · 패널 E (시간 축 · 중앙값 강조 · 0 선 · `InsightScatter` ticks/domain/zeroLine/emphasis). 사전 리뷰 info 2 · Codex P2 3 (반영 1 · #429 2) · 릴리즈 PR P2 2 (= #429). vitest 218 → 230.
- **#427 완료** (PR #428 문서 커밋).
- 프로덕션 진단 (사용자 실행 쿼리): `jsonb_typeof(heartRateValues)` null 2,132일 / array 156일 · null 행 중 385건은 04-07 최초 싱크분 · 로컬 dev DB 의 같은 날짜엔 시계열 · HRV 존재 → #431.

**세션 관찰:**
- **"키 존재" 와 "값 존재" 는 다르다** — `rawData ? 'heartRateValues'` 는 null 값도 센다. 새 rawData 필드를 승격하기 전엔 `jsonb_typeof` 로 기간별 분포를 먼저 본다 (#418 이슈의 확인 쿼리가 이 함정에 걸렸다).
- 로컬 dev DB (2026-04-07 싱크 7일) 가 프로덕션 손실을 증명하는 증거가 됐다 — dev DB 를 함부로 재싱크하지 말 것.
- `gh pr create --base dev` 의 `Closes #N` 은 기본 브랜치 (main) 머지에만 작동 — dev PR 은 이슈를 직접 닫는다.
- Codex 종료 규칙 2회 적용 (PR #426 → #427 · PR #428 → #429). 릴리즈 PR 에 같은 P2 가 다시 붙으면 트래킹 이슈 번호로 답하고 게이트 통과 처리.

---

## 이전 상태 (2026-09-23, M16-1 HRR · v2.35.0 배포 시점)

**최근 릴리즈:** **v2.35.0** — 러닝 종료 후 심박 회복 (HRR) 활동 상세 섹션 (#418, PR #423 · 릴리즈 PR #424). main = `v2.35.0`, 배포 success (migration 없음 · 패키지 변경 없음). dev 는 문서 PR #426 (로드맵 M16-1 · D8 표 · 418 스펙 마감 · 이 절) 만 앞섬 — 런타임 동일. **다음 마일스톤은 M16** 으로 시작 (M16-1 = #418).

**배포 후 프로덕션 확인 (2026-09-23):** `heartRateValues` 는 **2020-06-18 부터 2,288일** — 러닝 2,157건 전 기간 커버 ("기록 없음" 은 워치 미착용일에만). Garmin `recoveryTime` 은 **0 / 2,157** → 보조 표기 영구 제외, 2분 HRR 이 정본.

### 인계 (다음 세션에서 이어갈 것)

**오픈 PR 없음 (#426 머지 2026-09-23).** 다음 착수 후보 (이슈 없는 항목은 표기):

| 후보 | 내용 | 비고 |
|---|---|---|
| **#425 `/insights` 연도별 HRR** (feature · P2) | `Activity.hrr2 Int?` 승격 (수동 SQL · `prisma-drift-fix`) + 싱크 시 채움 + `backfill:hrr` (API 호출 0 · 날짜별 HeartRateRecord 1회 로드) + 5번째 패널 "회복이 빨라졌나?" (연도별 중앙값 · 5건 미만 해 —) | #418 의 `src/lib/heart/recovery.ts` 재사용 (`recoveryCurve` · `recoveryDayKeys`). 착수 시 2020~2022 샘플 간격이 2분 격자인지 확인 (`jsonb_array_length` ~700/일) — 다르면 결측률 캡션. 6년치 전부 계산 가능 (위 프로덕션 확인) |
| **#414 과거 활동 재조회** (bug · P2) | Garmin 에서 과거 활동을 레이스로 바꿔도 증분 싱크가 다시 안 가져옴 | 최근 N일 겹침 재조회 또는 명시 명령 + 문구 정정 |
| **#419 `/insights` 후속** (chore · P2) | RSC 페이로드 · 레이스 점 연도 색 · 제외 사유 문구 | 작음 |
| D8 잔여 (이슈 없음 · #397 체크리스트) · 과거 존 분포 (이슈 없음) | 아래 이전 상태 표 그대로 | 착수 시 이슈 생성 |

**독립 후속 (전부 P2):** #405 + #408 묶음 · #403 · #413 · #390 · #365 잔여 · #371 · #370.

**이번 세션 결과 (2026-09-23):**
- **#418 완료 (v2.35.0, PR #423)** — 스코프 분할 (활동 상세만 · 연도별 패널은 #425). `src/lib/heart/recovery.ts` 순수 (±60초 최근접 · 보간 없음 · `elapsedDuration` 벽시계 종료 · `recoveryDayKeys` 자정 앞뒤 날) + `load-recovery.ts` (활동 rawData 는 서버에서만 · 직렬화 DTO) + `RecoverySection` (2분 격자 점 · 결측 점선 빈 원 · 0 → +2 낙차 브래킷 · 판독값 2칸 양수 = 회복 · 빈 상태 3구분 · "2분 해상도"). 시안 `docs/designs/418-hr-recovery/`. 사전 리뷰 major 1 (자정 직후 종료의 전날 레코드 미조회 → 앞 창 + 회귀 2건) · info 2 반영. vitest 202 → 218건.
- **Codex bot 이 PR #423 · 릴리즈 PR #424 모두 자동 리뷰를 붙이지 않았다** (2026-09-23). 일반 PR 은 에이전트 필수 경로라 사전 리뷰가 완료 판정, 릴리즈 PR 은 사용자가 머지 결정. 두 body 에 `봇: 미실행` 기록. 문서 PR #426 에는 붙었다 (P2 1 — 이 절 갱신).

**세션 관찰:**
- **하루치 심박 시계열은 활동 심박을 그대로 담는다** (04-05 트랙 러닝 avgHR 123 → 시계열 121~128). `Activity.startTime` 은 UTC 인스턴트 (`rawData.startTimeGMT`), `HeartRateRecord.date` 는 KST 자정 인스턴트 — psql 세션 TZ 가 Asia/Seoul 이라 `timestamp without time zone` 컬럼에 `at time zone 'Asia/Seoul'` 을 붙이면 **이중 변환**된다 (한 번 헷갈림). 비교는 `to_timestamp(ms/1000)` (timestamptz) 와 컬럼을 직접.
- `rawData.elapsedDuration` (벽시계) 과 `duration` (타이머) 은 일시정지 시 다르다 — 시각 계산엔 elapsed.
- 시안 · 실화면 캡처는 이전 세션의 CDP 스크립트 (`capture.mjs` · `capture-live.mjs`) 를 스크래치에 복사해 재사용. 섹션만 자르려면 `getBoundingClientRect` 로 clip 을 잡는다 (`capture-section.mjs`). 첫 실행에서 Chrome 기동 1.5초 대기가 짧아 실패할 수 있다 — 재실행하면 된다. 실패 시 디버그 포트의 Chrome 이 남으니 `lsof -ti :<port> | xargs kill`.
- 리뷰 에이전트 worktree 는 `--detach` 를 지시해도 worktree 디렉터리와 `worktree-agent-*` 브랜치가 남는다 — `git worktree remove --force` + `branch -D` 로 정리.

---

## 이전 상태 (2026-09-22, M15-4 하이라이트 · M15-5 `/insights` · **M15 완료** · v2.34.0 세션 종료 시점)

**최근 릴리즈:** **v2.33.0** — 하이라이트 (#396, PR #412 · `Activity.eventType` 마이그레이션 + 프로덕션 백필 완료 race 14) · **v2.34.0** — `/insights` 심화 시각화 (#397, PR #417). main = `v2.34.0`, dev 는 문서 커밋 (로드맵 · 이 인계 문서) 만 앞섬 — 런타임 동일. 둘 다 배포 success · 배포 후 사용자 실데이터 확인 완료. **M15 마일스톤 완료** (2026-09-18 ~ 09-22, v2.30.0 ~ v2.34.0, 추적 #392 닫음).

### 인계 (다음 세션에서 이어갈 것)

**오픈 PR 없음. 다음 마일스톤 미정 — 후보를 사용자와 정한다.** 후보 (모두 이슈 있음):

| 후보 | 내용 | 비고 |
|---|---|---|
| **#418 HRR** (feature · P2) | 러닝 종료 후 심박 회복 — `HeartRateRecord.rawData.heartRateValues` (2분 간격 684샘플/일) 로 종료 후 +2/+4/+6/+10분 곡선 + **2분 HRR** (`hrr2` = 종료 시점 − 2분 후) 을 활동 상세에, 이력이 쌓이면 `/insights` 5번째 패널 | 사용자 직접 요청 (2026-09-22). API 호출 0. **해상도 제약 (PR #422 Codex P2):** 2분 간격 소스라 워치의 1분 HRR 은 못 만든다 — 오프셋은 2분 배수로만, 각 오프셋은 ±60초 안의 가장 가까운 샘플 (없거나 null 이면 그 점 결측), 보간 금지, UI 에 "2분 해상도" 표기. 활동 상세 엔드포인트 (`activity-service/activity/{id}/details`, 초 단위) 는 활동 구간만 담아 종료 후 회복엔 못 쓴다. 이슈에 프로덕션 확인 쿼리 2개 (`recoveryTime` 존재 · heartRateValues 시작일). UI → 디자인 단계 |
| **#414 과거 활동 재조회** (bug · P2) | Garmin 에서 과거 활동을 레이스로 바꿔도 증분 싱크 (`lastSyncDate + 1`) 가 다시 안 가져옴. 레이스 표 "다음 싱크에 반영" 문구는 새 활동에만 참 | 최근 N일 겹침 재조회 또는 명시적 명령 + 문구 정정. 활동 이름 · 유형 변경도 같은 문제 (기존) |
| **#419 `/insights` 후속** (chore · P2) | RSC 페이로드 (점 4,300개 툴팁 문자열 · href 직렬화 400~500KB) · 레이스 점 연도 색 · 제외 사유 문구 (거리 없음) | 배포 후 콜드 응답이 1s 안이면 페이로드 항목은 낮춤. 나머지 둘은 표시 정확도 — 작음 |
| D8 잔여 (미선별 전부) | 러닝: 유산소·무산소 TE · `intensityLabel` 비율 월별 · 케이던스 · 보폭 · 수직진폭 추세 (`/trends` 지표 등록 1건씩) · 요일/시간대 히스토그램 · `routeTag` 반복 코스 비교 — 수면: 단계 비율 월별 스택 · HRV + 7일 기준선 · 최저 SpO2 월별 (HRV 2026-04~ · SpO2 는 baseline 상대) — 일상: 스트레스 고·중·저 스택 · 바디배터리 충전/소모 — 체중: 전체 이력 + 목표선 · 월별 칼로리 밸런스 vs 체중 변화 — 교차: 수면 점수 → 다음날 페이스 | `docs/specs/m15-overview.md` D8 표 (✅ 4건 · #418 제외한 나머지 전부) · #397 체크리스트. 취침·기상 산점도는 `/lifestyle` 에 이미 있어 제외 |
| 과거 존 분포 | `zoneDistribution` 없는 러닝 1,550건 (2020-06 ~ 2024-11) — rawData 에 `hrTimeInZone` 0건. 활동별 API (`activity-service/activity/{id}/hrTimeInZones`) 1,550회 | 이슈 없음. 존 패널이 2024-12 부터인 이유. 감사 D 표와 함께 판단 |

**독립 후속 (전부 P2):** #405 + #408 묶음 (히스토리 하한 입구) · #403 (프로세스 간 캐시) · #413 (`/trends` 포인트 클릭 접근성 — YoY 키보드 경로 없음) · #390 · #365 잔여 · #371 · #370.

**이번 세션 결과 (2026-09-22):**
- **#396 완료 (v2.33.0, PR #412)** — `Activity.eventType String?` + 인덱스 (수동 SQL · `prisma-drift-fix`), 파서 `parse-event-type.ts` 를 fetcher (create · update) 와 `backfill:event-type` 이 공유. `/trends` 개인 기록 탭 (버킷별 최저 페이스 · 최장 · 최다 km 월 · VO2max · RHR · 레이스 표) · 시계열 이벤트 마커 3종 (무채색 · 같은 버킷 합침 · 연 단위 밴드 없음) + 이벤트 목록 + `marks=0` · 포인트 클릭 → `/history` (지표 쿼리 유지 — #409 P2 편입) · `/history` 연 뷰 커버리지 띠 (소스 8개, MCP `get_data_coverage` 집계 공유 → `src/lib/history/coverage.ts`). `running-buckets` 를 `src/lib/running/` 으로. 사전 리뷰 major 2 · info 11 + Codex 3회 (P2 5 — 반영 4 · #414 1). 프로덕션 백필: race 14 · training 1 · uncategorized 2320.
- **#397 완료 (v2.34.0, PR #417)** — `/insights` 4 패널 (질문 → 차트 → 답): 효율 산점도 (기준 구간 5'00"~5'30" 연도별 평균 심박) · 기온 vs 페이스 (습도 3단 · 5°C 구간 중앙값) · 월별 존 100% 스택 (2024-12~) · 주간 km → 다음 주 RHR (피어슨 r 지연 0/1/2 · km 구간 표). 순수 로직 `src/lib/insights/` + vitest. 사전 리뷰 major 1 · info 8 + Codex 2회 (P2 3 — 반영 1 · #419 2). vitest 152 → 202건.
- 프로덕션 실측: 러닝 2,156건 (페이스+심박 2,155 · 기온 2,136 · 존 606 (2024-12~) · 케이던스 2,155) · RHR 2,284일 (2020-06-18~).

**세션 관찰:**
- **Next 16 서버 → 클라이언트 경계 두 번 걸림**: (1) `"use client"` 모듈의 비컴포넌트 export (`ZONE_NAMES` 배열) 를 서버 컴포넌트가 import 하면 참조 프록시라 `.map is not a function` (2) 서버에서 클라이언트 차트로 함수 prop (`format`) 을 넘기면 "Functions cannot be passed directly to Client Components". 해법: 상수 · 포맷은 `"use client"` 없는 일반 모듈 (`zone-colors.ts` · `scatter-format.ts`) 에 두고 함수는 **이름** 으로 넘겨 클라이언트에서 해석. memory `project_next_rsc_boundary`.
- **Recharts 클릭 가로채기**: 툴팁 `cursor` (컬럼 사각형 · 세로선) · `ReferenceLine` · `ReferenceArea` 가 막대 · 점 위에 그려져 클릭을 먹는다 → `pointerEvents: "none"`. 정적 점 층 (`recharts-line-dots`) 이 활성 점보다 위라 **정적 점 자체에 onClick** 을 걸어야 한다. CDP `Input.dispatchMouseEvent` 클릭 테스트 (`elementFromPoint` 로 가로채는 요소 확인) 가 잡았다. memory `feedback_recharts_defaults` 에 추가.
- 시안 프로토타입 캡처는 CDP 스크립트 (`Emulation.setDeviceMetricsOverride` + `Page.captureScreenshot`) 로 — headless `--window-size=360` 은 최소 창 폭을 강제해 폰 화면이 잘려 보인다 (CSS 문제가 아님).
- `prisma format` 은 스키마 전체를 재정렬한다 — 컬럼 추가 시 실행하지 않는다 (diff 400줄).
- 백필은 싱크 stamp · 수동 쓰기 버전을 안 올려 캐시 (TTL 10분) 가 옛 값을 보여 준다 — 백필 후 `pm2 restart` 또는 10분 대기.
- Codex 종료 규칙 실행: #396 은 P2 3라운드 (3회차 → #414), #397 은 P2 2라운드 (2회차 → #419). 둘 다 "후속 이슈 + PR 코멘트 + body 갱신, push 없음" 으로 끝남.

---

## 이전 상태 (2026-09-21, M15-2 `/history` · M15-3 `/trends` · v2.32.0 세션 종료 시점)

**최근 릴리즈:** **v2.31.0** — `/history` 브라우저 + summary 메모리 캐시 (#394, PR #402) · **v2.32.0** — `/trends` 추이 분석 (#395, PR #407). main = `v2.32.0`, dev 는 문서 커밋 (로드맵 · 이 인계 문서) 만 앞섬 — 런타임 동일. 둘 다 배포 success · migration 없음 · 패키지 변경 없음 · 배포 후 사용자 실데이터 확인 완료.

### 인계 (다음 세션에서 이어갈 것)

**오픈 PR 없음. 다음 착수: #396 하이라이트 (M15-4).** 스키마 변경 (`Activity.eventType` 컬럼 승격 + rawData 백필 · API 호출 0) 이 있어 `prisma-drift-fix` 절차 + 에이전트 사전 리뷰 필수. UI 는 M15-2/3 시안 (`docs/designs/394-history/` · `395-trends/`) 에 **추가** 하는 형태 — 새 디자인 언어를 만들지 않는다 (한 화면 한 지표 색 · 판독값 띠 · 불완전한 데이터 3구분).

**#396 에 편입된 항목 (릴리즈 PR #409 Codex P2):** `/trends` 최고/최저 판독값의 `/history` 링크 (`src/lib/history/trends.ts` `bucketHref`) 가 선택 지표를 싣지 않아 기본 지표로 열린다 → `historyMetricQuery(def.id)` 1줄 + `trends.test.ts` href 기대값. #396 의 "차트 포인트 → 일 뷰 링크" 가 같은 경로라 처음부터 지표를 실어 만든다. 이슈 코멘트에 기록됨.

**#396 착수 시 알아둘 것:**
- `/trends` 툴팁에는 링크를 못 넣는다 (Recharts 툴팁은 포인터를 따라다녀 클릭 불가) — 포인트 클릭은 `Bar`/`Line` 의 `onClick` + `router.push` 로.
- 이벤트 마커는 카테고리 X 축 (버킷 키) 위 `ReferenceLine x=<버킷 키>` — 동작 확인됨 (연 경계선이 이미 그렇게 그려진다). 이벤트 날짜 → 버킷 키는 `bucketKeyOf(ymd, granularity)`.
- 커버리지 띠는 MCP `get_data_coverage` 재사용이 스펙 문구지만, 웹은 `src/mcp/` 를 import 하지 않는다 — 로직을 `src/lib/` 로 올리거나 summary 의 `coveredDays/totalDays` 로 만든다 (착수 시 판단).

**독립 후속 (전부 P2):**

| # | 내용 | 비고 |
|---|---|---|
| #405 + #408 | 히스토리 하한 입구 정리 — 하한 > 오늘 방어 (#405) · 첫 버킷 커버리지 분모 = 버킷 ∩ [하한, 오늘] · 하한 이전 포인트 제외 (#408) | **묶어서 한 PR.** 같은 입구 (`src/app/history/resolve.ts` · `validateSummaryParams` · `loadDailyPoints`). `view.ts` 의 `coverableDays` 를 공용으로 올린다. 둘 다 현재 프로덕션 데이터 (하한 2020-06-16 · 그 앞에 행 없음) 에서는 드러나지 않음 |
| #403 | 히스토리 캐시 프로세스 간 무효화 (봇 식단 기록 · 봇 발 싱크의 백그라운드 재계산) | 현재 최대 TTL 10분 지연 수용. DB epoch 행을 stamp 와 함께 읽는 방향. 일 뷰는 비캐시라 무관 |
| #390 | backfill 종료 시 weather lock 해제 실패 | 데이터 영향 없음 · TTL 10분 self-heal |
| #365 | 서버 로컬 TZ 잔여 | 이번 세션에서 `TrendLineChart` 의 브라우저 로컬 TZ 파싱 1건 흡수 (#395). 남은 것: 봇 `toLocaleDateString` · ecosystem TZ · `MonthlyHeatmap` (로컬 `new Date`) · `body-composition` route `parseLocalDate` · verify 스캔 확장 |
| #371 · #370 | orphan-check 스킬 오판 · 하네스 절대경로 | 하네스 정비 |

**이후 순서:** #396 → #397 심화 시각화 (D8 표에서 3~4개 선별). M15 완료 시 major/minor 판단.

**이번 세션 결과 (2026-09-21):**
- **#394 완료 (v2.31.0, PR #402)** — `/history/[year]/[month]/[day]` · 연 뷰 (월 카드에 미니 달력) · 월 뷰 (`MonthGrid` 신설, `MonthlyHeatmap` 무변경) · 일 뷰 (8행 장부) · 지표 3건 (`runningDurationSec` 비노출 · `calorieBalance` · `intakeKcal` = 식단 캘린더 B-2 흡수) · `selectable` · `format: "pace"`. **summary 메모리 캐시** (`cache-core.ts` 순수 / `cache.ts` globalThis 싱글턴): 키 = 파라미터 + `max(lastSyncAt)` + 수동 쓰기 버전 + today + lowerBound, TTL 10분 · 64 엔트리. 무효화 = 체중 · 식단 route `finally` + cron 후속 쓰기 + `recalculateAllCalorieBalances` 완료 시점. 사전 리뷰 major 2 · info 4 + Codex 4회 (P2 5 — 반영 4 · #403 1) + 릴리즈 PR P2 1 (→ #405).
- **#393 F12 닫음** — 프로덕션 재측정 (서버 내부, 전 지표 14개): 콜드 1.65s → **웜 0.090s · 0.003s** (이전 웜 1.09~1.22s). PR #406.
- **#395 완료 (v2.32.0, PR #407)** — `/trends` 4 뷰 (시계열 · 전년 동기 · 계절성 · 기간 비교), 상태 전부 URL 쿼리. 순수 로직 `trends-params.ts` · `trends.ts` · `compare.ts` · `range-totals.ts` (`rollup.ts` 의 `aggregatePoints` 공유) · `chart-format.ts`. 불완전한 데이터 3구분 (결측 / 기록 절반 미만 / 다 채워지지 않음 = `current` · `clipped`) · 레지스트리 `sparse` (체중 · ltPace). 사전 리뷰 major 3 · info 8 + Codex 4회 (P2 6 — 반영 4 · #408 2) + 릴리즈 PR P2 1 (→ #396). vitest 53 → 152건.
- **HRV 시작일 확인** — 야간 HRV (`SleepRecord.hrvOvernight`) 는 2026-04-20경부터만 있다. 프로덕션 쿼리로 `rawData->>'avgOvernightHrv'` 도 그 이전 전부 없음 확인 → Garmin 미제공 (파싱 누락 아님). memory `project_hrv_data_start`. 미확인 경로는 `hrv-service/hrv/{date}` (감사 D-1) 뿐.

**세션 관찰:**
- **Codex 자동 재리뷰는 문서 커밋에도 붙는다.** PR #407 4회차는 push 없이 PR body · 이슈만 갱신해 라운드를 끊었다 — P2 만 연속이면 "후속 이슈 + PR 코멘트 + body 갱신, **push 안 함**" 이 루프를 끝내는 방법이다. 남은 스펙 기록은 머지 후 문서 PR 에 묶는다.
- **로드맵 완료 표기 전에 스펙 체크리스트를 구현 상태로 맞춘다** (PR #406 Codex P2 2라운드). #395 는 PR 단계에서 F1~F22 체크 + 달라진 항목 ↳ 주석을 미리 넣어 문서 PR (#410) 이 0라운드로 끝났다.
- **`next dev` 는 `localhost` 로 연다.** `127.0.0.1` 로 열면 Next 16 이 `/_next/*` 를 교차 출처로 막아 **클라이언트 컴포넌트가 하이드레이션되지 않는다** (차트가 빈 컨테이너로 남음 · 에러 없음). 프로덕션 빌드와 무관. memory `project_next_dev_localhost_origin`.
- **headless 시각 검증**: Chrome `--screenshot` 은 `ResponsiveContainer` (ResizeObserver) 를 기다리지 않는다. Recharts 화면은 CDP (원격 디버깅 포트 + `node_modules/ws`) 로 실제 시간 대기 후 캡처해야 찍힌다. Claude in Chrome 확장은 이 세션 내내 미연결이었다.
- `next dev` 가 `CLAUDE.md` 끝에 `nextjs-agent-rules` 블록을 자동으로 덧붙인다 (gitignore 대상이라 커밋 영향 없음 · 지워도 다시 생김).

---

## 이전 상태 (2026-09-18 저녁, M15-1 집계 기반 · v2.30.0 세션 종료 시점)

**최근 릴리즈:** **v2.30.0** — M15-1 집계 기반 (#393, PR #399) + M15 마일스톤 스펙 (PR #398). main = `v2.30.0`, dev 는 이 인계 문서만 앞섬. 배포 success (migration 없음, 패키지 변경: vitest · postcss override). 배포 후 검증 ✅ (부분 합계 회귀 · lifestyle 카운트 · lowerBound 2020-06-17).

### 인계 (다음 세션에서 이어갈 것)

**오픈 PR 없음. 다음 착수: #394 `/history` 브라우저 (M15-2).** UI 라 `frontend-design` 디자인 단계 필수 (`docs/designs/394-history/`). 착수 절차: `branch-workflow` → 스펙 `docs/specs/394-history-browser.md` → 시안 → 승인 → 구현. 마일스톤 결정은 `docs/specs/m15-overview.md` D1~D3 (라우트 `/history/YYYY/MM/DD` · 일 뷰 = 일간 종합 페이지 8 섹션 · 초기 지표 러닝 km·걸음·수면 점수·RHR·체중).

**#394 에 추가된 스코프 (이번 세션 실측 결과):**
- **summary 메모리 캐시** — 프로덕션 F12: 6년 `granularity=year` 전 지표 웜 **1.09~1.22s** (목표 1s). 400 은 4ms, 소스 1개 155ms, 5소스 1.09s → DB 가 아니라 **Node 측 Prisma 행 역직렬화 (약 11,500행, 단일 스레드)** 가 병목 (서버 Pentium G4600 2C/4T). 키 = 파라미터 + `max(SyncMetadata.lastSyncAt)` + **수동 쓰기 버전** + TTL 10분. `getHistoryLowerBound` 도 캐시. raw query 금지라 DB 집계는 안 함.
  - **수동 쓰기 무효화 (PR #401 Codex P2):** `POST /api/body-composition` (`route.ts:58` upsert) 은 `SyncMetadata` 를 안 건드리므로 lastSyncAt 키만으론 저장 직후에도 옛 체중이 최대 TTL 동안 남는다. 모듈 레벨 `historyCacheVersion` 을 두고 수동 쓰기 route (body-composition · 향후 칼로리 밸런스 지표를 등록하면 food 경로도) 에서 bump → 키에 포함. 회귀 테스트: 체중 저장 후 summary 가 새 값을 반환.
  - **F12 는 열린 상태** (393 스펙 · 로드맵 M15-1 미완료 표기). 캐시 적용 후 웜 1s 이내 재측정으로 닫는다.
- 로드맵 M15-1 체크는 이 인계 PR 에서 처리함.
- 지표 추가 후보 (사용자 요청: 보이면 제안): 러닝 횟수·VO2max 는 레지스트리에 이미 있어 선택기 노출만, 칼로리 밸런스는 등록 1건.

**이후 순서:** #395 `/trends` → #396 하이라이트 (`Activity.eventType` 컬럼 승격 포함) → #397 심화. 독립: #390 (P2) · #365 잔여 (봇 `toLocaleDateString` · ecosystem TZ · 클라이언트 컴포넌트 · 스캔 확장 — 이슈 코멘트에 처리/잔여 정리됨) · #371 · #370.

**이번 세션 결과 (2026-09-18):**
- **M15 기획** — 사용자 요청 (연/월/일 브라우저 · 기간 추이 · UI 추천 · 시각화 기획) 검토 → `m15-overview.md` (D1~D8) · 추적 #392 · 하위 #393~#397. 릴리즈 PR #398 Codex P2 1건 (하한 규칙 충돌) 반영.
- **#393 완료 (v2.30.0, PR #399)** — `src/lib/history/` (버킷·레지스트리 11지표·롤업·조회·하한·summary) · `/api/history/summary` · activities/export `from/to` · 페이지 3개 KST 헬퍼 (#365 페이지 부분 흡수) · **vitest 4 도입** (52건). 사전 리뷰 major 1 (버킷 스팬 vs from/to 조회 → 부분 합계) + info 5 전부 반영. Codex 👍.
- **환경 발견** — `overrides` 의 `"$postcss"` 참조 때문에 새 패키지 `npm install` 이 `Unable to resolve reference $postcss` 로 실패 (npm 10.8 arborist). 리터럴 `^8.5.10` 로 교체. `$esbuild` 는 남아 있음 → 다음 패키지 추가 시 같은 증상이면 같은 처방. vitest 5 는 Node 22 필요라 4 고정. `vitest.config.mts` (Node 20 CJS 로드).

---

## 이전 상태 (2026-09-18, fitness metrics 이력 · v2.29.0 세션 종료 시점)

**최근 릴리즈:** **v2.29.0** — VO2max · 젖산역치 이력 싱크 (#378) + lastSyncDate 단조 증가 (#381) + 빈 stub 방지 (#383). main = `v2.29.0`. dev 는 이 인계 문서 커밋만 앞섬 — 런타임 동일. 배포 success (migration `add_fitness_metric_daily` 적용).

### 인계 (다음 세션에서 이어갈 것)

**오픈 PR 없음. 다음 착수 후보 (우선순위 순):**

| # | 내용 | 우선순위 | 비고 |
|---|---|---|---|
| #390 | backfill 스크립트 종료 시 weather backfill lock 해제 실패 (fire-and-forget 이 `$disconnect` 뒤에 실행) | P2 | v2.29.0 배포 검증에서 관찰. 데이터 영향 없음, lock TTL 10분 self-heal. `syncAll` 에 weather skip/await 옵션 |
| #365 | 서버 로컬 TZ 날짜 라벨 잔여 (봇·lifestyle·TZ 고정) | P2 | 감사 A1 코멘트 포함 |
| #371 · #370 | orphan-check 스킬 오판 · 하네스 절대경로 | — | 하네스 정비 |
| (미생성) | 감사 도입 후보 D-1 HRV 서비스 싱크 → D-2 복원력(429 백오프·타임아웃·토큰 권한, A6·A7) → D-3/D-4 활동 싱크·컬럼 → D-5 training daily → D-6 race prediction → D-7 splits 캐시 | — | 착수 시 이슈화. D-2 는 #383 의 privacyProtected 토큰 폐기(`evictPersistedToken`)와 맞물림 |
| (미생성) | 워치 미착용일 + 식단 기록 시 `dailyBalances[].intake` 누락 | P3 | #383 스펙 §3.3 수용 트레이드오프. 필요 시 FoodLog 경로에서 DailySummary 행 생성 |

**이번 세션 결과 (2026-09-18):**
- **#378 완료 (v2.29.0, PR #385 · #389)** — `FitnessMetricDaily` + `fitness_metrics` dataType + MCP `get_fitness_metric_trend`. 사전 리뷰 major 2/info 7 + Codex 2회(P2 4) + 릴리즈 PR Codex P2 2 (→ #389 로 반영). 프로덕션 backfill 2020-06-01~ 7청크 1분, 2,000행 (2020-06-26~).
- **#381 완료 (v2.29.0, PR #386)** — `updateSyncMetadata` 단조 증가 + 미래 endDate 거부/clamp/자가 복구. Codex 3회(P1 2 · P2 1) 전부 반영.
- **#383 완료 (v2.29.0, PR #387)** — 빈 날 skip · privacyProtected → 토큰 폐기+403 · cleanup 스크립트 · `get_weight_loss_status` streak 달력 기준. 사전 리뷰 major 3 + Codex 3회(P2 3). 프로덕션 정리: DailySummary/HeartRateRecord 각 384행 삭제 (2019-06-01~2020-06-18), 최초 기록 2020-06-19.
- **실사용 검증 ✅** — `/ai` "VO2max 가 가장 높았던 때" → 전체 기간 기준 최고 50.4 (2022-07-02), 월별 맥락, 현재값 기준일 인용.
- **관찰** — backfill 종료 직후 weather backfill lock 해제 실패 (→ #390). Codex 는 push 마다 자동 재리뷰돼 세 PR 모두 2~3라운드 (P1 은 #386 의 2건만 실결함, 나머지 P2). 릴리즈 PR 에도 P2 가 붙어 dev fix PR(#389)로 반영 — 릴리즈 PR 직접 커밋 없이 처리하는 경로가 실제로 동작함.

**세션 절차 메모:** 리뷰 에이전트를 worktree 격리로 돌릴 때 에이전트가 `git checkout <branch>` 하면 그 브랜치가 main 트리에서 잠긴다 — 에이전트에게 `git checkout --detach origin/<branch>` 를 지시할 것. 리뷰 반영 후 검증 어서션이 옛 코드 형태를 고정한 경우가 두 번 있었다 — 4종 검증 exit code 로 커밋을 게이트하면 잡힌다 (`if [ $rc -eq 0 ]`).

---

## 이전 상태 (2026-09-17, MCP 장기 조회 · v2.28.0 세션 종료 시점)

**최근 릴리즈:** **v2.28.0** — MCP 장기 조회 (#377) + npm audit 4건 (#376). main = `v2.28.0`. dev 는 이 인계 문서 커밋(PR #384)만 앞섬 — 런타임 동일, 다음 릴리즈는 다음 실코드 변경과 묶음. 배포 success.

### 인계 (다음 세션에서 이어갈 것)

**다음 착수: #378 VO2max · 러닝 젖산역치 Garmin 이력 싱크** — 스펙 `docs/specs/378-garmin-fitness-metrics-history.md` 작성·이슈 생성 완료. 엔드포인트·시작일·단위는 memory `project_garmin_metric_history_endpoints` 와 #377 스펙 §1-3 에 실측값. 착수 시 `branch-workflow` (feat/378-1), DB 모델 추가라 `prisma-drift-fix` 절차, 사전 에이전트 리뷰 필수. 배포 후 `backfill:history -- --types=fitness_metrics --from=2020-06-01` (호출 21회, 1분).

**이번 세션 결과 (2026-09-17):**
- **#377 완료 (v2.28.0, PR #379)** — days 상한 3650 · granularity/endDate · 400행 승격 · `get_data_coverage` · 시스템 프롬프트 · `backfill:history`. 사전 리뷰 critical 1/major 2/info 5 + Codex 6회(P1 3 · P2 8) 전부 반영. 릴리즈 PR Codex P2 1건 → #381.
- **#376 완료 (v2.28.0, PR #382)** — next 16.3.5 · sharp/js-yaml/hono overrides. Security Audit success.
- **프로덕션 backfill 완료 (2026-09-17, 6청크 4.6h, 실패 0)** — 전 타입 `oldestFetchedDate` 2019-06-01, `lastSyncDate` 유지 확인. 실데이터: 활동 2020-06-19~ (2,332건), 체중 2020-06-16~ (372건). 2020-06 이전은 워치 사용 전 — daily/HR 는 빈 stub 행 (→ #383).
- **실사용 검증 ✅** — `/ai` "전체 기록에서 컨디션 최고 시기" 질문이 2020-06~ 전체 기준으로 답변 (최고 시기 2023-11~2024-03, 체중·VO2max·페이스 비교). "365일 한도" 표현 사라짐. VO2max·LT 과거 이력만 #378 대기.
- **외부 Garmin MCP 2종 감사** → `docs/specs/garmin-endpoint-audit-20260917.md` (A1~A11 재검증 버그 · C 누락 데이터 소스 · D-1~D-9 도입 후보).

**오픈 이슈 (우선순위):**
| # | 내용 | 우선순위 | 비고 |
|---|---|---|---|
| #378 | VO2max · 젖산역치 이력 싱크 | **P1 · 다음** | 스펙 완료 |
| #383 | 빈 DailySummary/HeartRateRecord stub 저장 방지 + 정리 스크립트 | P2 | 감사 A11. backfill 로 2019-06~2020-06 stub 367행 확인 |
| #381 | backfill 중 동시 싱크 lastSyncDate 경쟁 — `updateSyncMetadata` 단조 증가 | P2 | 릴리즈 PR Codex. 감사 D-2(복원력: 429 백오프·타임아웃·토큰 권한)와 묶어도 됨 |
| #365 | 서버 로컬 TZ 날짜 라벨 잔여 (봇·lifestyle·TZ 고정) | P2 | 감사 A1 (`getSleepData`/`getHeartRate` 라이브러리 TZ 의존) 코멘트로 추가됨 |
| #371 · #370 | orphan-check 스킬 오판 · 하네스 절대경로 | — | 하네스 정비 |

**감사 도입 후보 (이슈 미생성, 착수 시 이슈화):** D-1 HRV 서비스 싱크(A2 이중 호출·baseline null 해소) → D-2 복원력 → D-3 활동 싱크 `startDate/endDate/limit` + D-4 컬럼 승격(`eventType`·`movingDuration`·`activityTrainingLoad`·GAP) → D-5 training readiness/status 일별 → D-6 race prediction 이력 → D-7 splits DB 캐시(A5).

**세션 관찰:** Codex bot 이 `@codex review` 없이도 push 마다 자동 재리뷰된 라운드가 있었다 (PR #379 4·5회차, 릴리즈 PR #380). 총 7라운드 중 P1 3건은 실결함이었고 P2 는 마지막 2라운드부터 미세 조정 → memory `project_codex_auto_rereview`.

---

## 이전 상태 (2026-09-03, 식단 편집 · 보안 세션 종료 시점)

**최근 릴리즈:**
- **v2.26.1** — Phase 4 hotfix (Garmin naive-TZ 이슈 완전 해결)
- **v2.26.2** — 수면 SpO2 파싱 키 오타 수정 (#338) · 최저/최고 SpO2 저장
- **v2.27.0** — 야간 SpO2 그래프 (#342) · SpO2 표시 일관성 (#341)
- **v2.27.1** — 월간 SpO2 트렌드 차트 라벨 정정 (#346)
- **v2.27.2** — 식단 편집 force_reply 제거 · chat 단위 pending 전환 (#350)
- **v2.27.3** — npm audit 취약점 8건 해소 (#354) · 프롬프트 발송 실패 시 pending 잔존 (#357)
- **v2.27.4** — Security Audit 파서 fail-closed · Dependabot 자동 보안 PR 비활성화 (#359)

### 인계 (다음 세션에서 이어갈 것)

**오픈 이슈 0건.** main = `v2.27.4`, dev 는 문서 커밋만 앞섬 (런타임 변화 0 → 릴리즈는 다음 실코드 변경과 묶음).

**실사용 확인 결과 (2026-09-04):**

| # | 확인 | 릴리즈 | 결과 |
|---|---|---|---|
| 1 | 식단 수정 후 앱 재진입 시 답장 입력폼 미재생성 — 이번 세션의 최초 문제 | v2.27.2 | ⚠️ **재현됐으나 코드 정상** — 원인은 2번(옛 메시지 잔존). 아래 참조 |
| 2 | 이미 폰에 박혀 있던 프롬프트 해소 여부 | v2.27.2 | ❌ `remove_keyboard` 로 **해소 안 됨** → 사용자가 메시지 직접 삭제해 해결 |
| 3 | `[✕ 취소]` 동작 · pending 중 `/today` 가 명령으로 처리 · 비숫자 4회 입력 시 3회째까지 재프롬프트 후 종료 | v2.27.2~3 | ⬜ 미확인 |
| 4 | AI 어드바이저 질문 1건 → MCP 도구 호출 정상 (`fast-uri` 3.1.5→3.1.7 영향) | v2.27.3 | ⬜ 미확인. 로컬 `tools/list` 22개는 정상 |
| 5 | Garmin 싱크 정상 (`qs` 6.15.2→6.16.0 영향) | v2.27.3 | ✅ **정상** — `qs` bump 안전 확정 |

**1·2번 결론 — F7 (`remove_keyboard`) 은 실기기에서 동작하지 않았다.**
1번 재현 신고를 받고 배포/코드를 먼저 검증했다: v2.27.2~4 deploy 워크플로우 전부 `success`, `npm run build` 가 `build:bot` 을 포함하므로 `dist/bot/standalone.cjs` 도 재빌드됨, `src/` 에 `force_reply` 발송 지점 0건 (주석·스크립트 언급뿐). 즉 **신규 발송 경로는 정상**이고, 재현의 정체는 09-03 이전에 발송돼 채팅방에 남아 있던 옛 프롬프트 메시지였다. `force_reply` 는 텔레그램 **클라이언트가 메시지 단위로 저장**하는 상태라, 서버 코드를 고쳐도 그 메시지가 채팅방에 있는 한 재진입마다 계속 재무장된다.

- **#350 스펙 §7 이 이 한계를 이미 제외 사항으로 명시**했고 (`remove_keyboard` 는 best-effort), 실기기 결과로 **best-effort 가 실패한다는 것이 확정**됐다. 유일한 확정적 해소는 **해당 메시지 삭제**.
- **교훈**: force_reply 를 한 번 보내면 회수 수단이 없다. Bot API 에 회수 메서드가 없고 `remove_keyboard` 도 안 먹는다. → memory `feedback_telegram_force_reply_sticky`
- **수정 대상 아님.** 재발 조건도 없다 (신규 프롬프트는 force_reply 를 안 쓰므로 새로 박힐 게 없음).

추가 확인:
- **다음 월요일 03:00 UTC `Security Audit` 스케줄 실행** — 스케줄은 default branch 파일을 쓰므로 v2.27.4 로 비로소 새 파서가 적용됨
- **다음 `git push` 시 `GH007`** — 전역 git 이메일을 개인 Gmail 주소 (GitHub 계정에 등록됨) 로 바꿔서, "Block command line pushes that expose my email" 이 켜져 있으면 push 가 거부됨. 뜨면 그 설정을 끈다 — noreply 전환은 하지 않기로 결정했으므로 (개인 주소 노출은 수용, 회사 주소만 차단이 목표).

**로컬 잔여 브랜치 (이전 세션):** `chore/m6-roadmap`, `fix/203-3`, `fix/203-4`, `fix/220-1`, `fix/261-2`. 전부 dev 보다 한참 뒤처져 있음. `fix/261-2` 만 원격 없음. 정리 여부 미결정.

**이번 세션의 발견 (memory 반영됨):**
- **릴리즈 PR 은 merge commit 필수.** v2.27.2(#352)를 squash 한 탓에 main↔dev 공통 조상이 끊겨 다음 릴리즈 PR #356 이 3개 파일에서 충돌했다 (내용은 동일했는데도). main 을 dev 로 back-merge 해 복원. → memory `feedback_release_merge_commit`
- **`Closes #N` 은 default branch 머지에만 동작.** `dev` 로 가는 PR 은 이슈가 자동으로 닫히지 않으므로 수동 close 필요.
- **Dependabot 보안 PR 은 `target-branch` 로 못 옮긴다** — 항상 default branch 를 타겟. 게다가 커버리지가 자체 audit 의 부분집합이었다 (#353 이 4건, #355 가 6건). → #359 에서 자동 PR 비활성화, 알림은 유지.
- **커밋 이메일이 회사 주소로 노출돼 있었다.** 전역 git config 가 회사 주소였고 저장소가 public 이라 GitHub 공개 API 가 590 커밋의 이메일을 평문 서빙. OSS 파트너십 스팸의 유입 경로. GitHub 의 이메일 privacy 설정은 **계정에 등록된 주소만** 보호하므로 이 케이스엔 애초에 무력했다. 전역을 개인 Gmail 로, 회사 저장소 13개는 로컬 override 로 정리. **기존 590 커밋은 그대로 두기로 결정** (이력 재작성 비용 대비 실익 낮음, 포크·스타 0). → memory `project_commit_email_exposure`
    - **결론 (2026-09-04 사용자 결정)**: `users.noreply.github.com` 전환은 **하지 않는다**. 이 저장소는 public 이라 config 변경 이후 커밋도 개인 Gmail 이 commit metadata 에 평문으로 실리지만 (`/repos/.../commits/<sha>` 확인됨), 목표는 **회사 주소 비노출**이고 그건 달성됐다. 개인 주소 노출은 수용 범위.
    - **문서 규칙**: 이 저장소는 public 이므로 스펙·인계 문서에 실주소를 적지 않는다 (#362 Codex P1).

---

## 우선순위 A (사용자 요청 or 실사용 지장)

### A-1. Blood pressure fetcher 도 naive-TZ 이슈 검증
- **배경**: v2.26.1 body-composition hotfix 발견 시 사전 리뷰가 blood-pressure 도 같은 exclusive endDate + naive-TZ 이슈 가능성 언급. 사용자 관찰 표본 부족으로 미확정.
- **스코프**: `src/lib/garmin/fetchers/blood-pressure.ts` 의 endDate 처리 · entry timestamp 필드 관찰. inspect script 준비.
- **트리거**: 사용자가 혈압 측정한 오늘 값이 sync 후 DB 반영 안 됨을 관찰하면 즉시 착수.
- **참고**: v2.26.1 릴리즈 노트 §후속.

### A-2. 트렌드 · 도넛 · 근손실 위험 카드도 선택 날짜 기반 재계산
- **배경**: `/nutrition?date=X` 는 카드/리스트만 selected 날짜 · 트렌드/도넛/근손실 위험 (7일 aggregate) 은 오늘 기준 유지. 스코프 축소된 상태.
- **스코프**: `page.tsx` fetch (`aggregateRecentMacros`, `activities7d`, `latestBalances`) 에 selected 날짜 기준 옵션. 근손실 위험 assessor 도 재계산. UI 뷰 라벨 "최근 7일" → "선택 날짜 기준 7일" 로 조정.
- **주의 (Codex P2 재⁴재⁵지적, historical window)**: 현재 risk 계산 (`page.tsx:113-124`) 은 오늘 (incomplete day) 을 명시 제외하고 today-7..today-1 사용. Selected 가 과거 = 완료된 day 라 **selected 자체를 포함해야 함**. 하지만 오늘 조회 시 `selectedEnd = todayEnd = 다음 KST midnight` 이라 그대로 두면 오늘 (incomplete) 도 포함 → 기존 방어 뒤집힘. 조건부 window 필수:
    - `isToday` → `[todayStart - 7*DAY_MS, todayStart)` (기존 정책 유지 · 오늘 제외)
    - `!isToday` (historical) → `[selectedEnd - 7*DAY_MS, selectedEnd)` (selected 완료된 day 포함)
- **결정 필요**: 도넛 "오늘" 탭도 selected 날짜로 재라벨링 vs "선택 날짜" 로 아예 rename (C-2 와 함께).
- **주의 (사전 리뷰 지적)**: `latestWeight` (`page.tsx:82`) 는 지금 항상 `orderBy date desc` 최신 row 반환 → 과거 날짜 조회 시 미래/현재 weight 가 `protein-per-kg` 산출과 근손실 assessor 에 섞임. 이 스코프에 반드시 "선택 날짜 당일까지의 최신 weight" 조회로 교체 포함. **Predicate 는 exclusive upper `where: { date: { lt: selectedEnd } }` 사용** — `lte: selectedEnd` 는 selectedEnd (다음 KST midnight) 와 `startOfDay` 정규화된 다음 날 row 가 정확히 같은 instant 라 다음 날 measurement 포함하는 boundary leak (Codex P2 재재지적).
- **주의 (Codex P2 재지적)**: `todayLogsForDonut` (`page.tsx:178-192`) 는 v2.26.0 에서 도넛 "오늘" 뷰가 항상 실제 오늘 데이터로 남도록 하드코딩. A-2 스코프에 이 fetch 도 반드시 포함해 `selectedLogs` 재사용 (isToday 이면 그대로) 또는 selected day 범위로 재fetch 하도록 전환. C-2 (도넛 label date-aware) 만 하고 이 fetch 를 남기면 label 은 selected 인데 데이터는 오늘 → mismatch.

### A-3. Bot 명령으로 과거 식단 열람
- **배경**: `/nutrition?date=X` 는 웹 전용. 텔레그램 봇에서 과거 식단 조회 불가.
- **스코프**: `/food_show <date>` 또는 `/reports food <date>` 신설. inline keyboard 로 어제/그저께 등 shortcut. cuid 타이핑 요구 금지 (feedback_bot_mobile_ux 정합).

---

### A-6. 식단 편집 취소 버튼에 epoch/nonce 대조
- **배경**: `clearPendingEditFor` 는 logId 만 대조한다. 같은 로그를 편집 완료한 뒤 다시 편집을 시작하고, 스크롤을 올려 **예전 프롬프트의 `[✕ 취소]`** 를 누르면 진행 중인 새 편집이 취소된다.
- **스코프**: `food:edit-cancel:<logId>:<nonce>` 로 nonce 를 실어 대조. **아래 4가지를 한 덩어리로 처리해야 동작한다** (#362 Codex 리뷰 3라운드에 걸쳐 보강 — 원래 스코프는 1번만 적혀 있었고, 그대로 하면 모든 취소 버튼이 "알 수 없는 요청입니다" 로 떨어졌다):
    1. **상태·대조**: `markPendingEdit` 이 nonce 를 저장하고, 취소 콜백만 logId + nonce 를 함께 대조.
        - **삭제 cleanup 경로를 nonce 대조로 바꾸면 안 된다** (#362 Codex P2 재지적). `clearPendingEditFor` 호출부는 2곳인데 성격이 다르다: `:103` 은 사용자 취소 (nonce 있음 · 대조 필요), `:163` 은 삭제/P2025 cleanup 으로 **logId 밖에 없고 대상 로그가 사라진 게 확정된 경로**다. 후자까지 nonce 를 요구하면 삭제 후 pending 이 살아남아 다음 일반 메시지를 삭제된 로그의 입력으로 삼킨다 — PR #351 Codex P2 로 이미 한 번 고친 회귀다. **두 경로를 분리**할 것: `clearPendingEditFor(chatId, logId, nonce)` (취소 전용) + `clearPendingEditByLogId(chatId, logId)` (삭제 확정 전용, 무조건 정리).
    2. **파서**: `food-edit-callback.ts:48` 의 `parseCallbackData` 는 `parts.length !== 3` 이면 `null` 을 반환한다. 4-field 를 받도록 arity 를 풀고 (edit-cancel 만 4, 나머지 3 — 또는 `parts.length < 3` + optional 4번째), 반환 타입에 `nonce?: string` 추가. `auto-adjust-callback.ts` 의 동명 함수는 별개라 영향 없음.
    3. **발행 순서**: `armPendingEdit` (`food-edit-state.ts:136`) 은 `sendPrompt()` → `markPendingEdit` 순서다 (#357 fail-closed). 따라서 `markPendingEdit` 이 nonce 를 만들면 키보드 조립 시점에 값이 없다. **nonce 를 발송 전에 할당해 `sendPrompt` 에 넘기고, 저장은 발송 성공 후에** 하도록 리팩터 — #357 의 "발송 실패 시 pending 미잔존" 성질은 유지할 것.
    4. **재시도 프롬프트로 nonce 전달**: `buildCancelKeyboard` 호출부 3곳 (`food-edit-callback.ts:284,338,432`) 의 시그니처만 바꾸는 걸로는 부족하다 (#362 Codex P2 재지적). `:284` 는 신규 발행이라 방금 만든 nonce 를 쓰면 되지만, **`:338`·`:432` 는 재시도 경로**라 `peekPendingEdit` 이후에 실행된다. 그런데 `peekPendingEdit` (`food-edit-state.ts:103`) 은 `{ logId, action }` 만 반환한다 → 반환 타입에 `nonce` 를 추가해 **저장된 nonce 를 그대로 재사용**할 것. 새로 만들거나 `undefined` 로 두면 그 재시도 취소 버튼이 pending 과 불일치해 동작하지 않는다.
    - 64byte 한도: `food:edit-cancel:` 17 + cuid 25 + `:` 1 = 43 → nonce 에 21byte 여유. ms epoch(13) 은 안전하지만 짧은 random nonce 가 더 낫다 (같은 ms 재편집 충돌 회피).
- **우선순위 근거**: 실사용 확률 낮고 결과도 무해한 취소라 P0 로 분류됐다. 다만 pending 라우팅을 다시 손댈 때 함께 처리하면 저비용.
- **출처**: #350 사전 리뷰 P0, 스펙 `docs/specs/350-food-edit-force-reply-fix.md` §7.

---

## 우선순위 B (기능 확장)

### B-1. 식단 검색 (음식명 기준)
- **배경**: 날짜 조회는 되지만 "김치찌개 언제 먹었지?" 검색 불가.
- **스코프**: `/nutrition/search?q=김치찌개` or `/nutrition?q=` 파라미터. description 부분매치 + 최근 N일. 결과 리스트 → 클릭 시 해당 날짜 페이지.

### B-2. 캘린더 뷰 (월간 식단 개관)
- **배경**: 이전/다음 하루씩 이동만 있음. 특정 주 급 몰아보기 어려움.
- **스코프**: `/nutrition/calendar` 또는 현 페이지에 캘린더 컴포넌트 embed. 각 날짜 셀에 kcal 요약 · 클릭 시 그 날 상세. `MonthlyHeatmap` 재사용 검토.

### B-3. Items 개별 편집 · 삭제
- **배경**: v2.25.0 items breakdown 저장됐지만 편집은 항상 log 전체 재기록. 비빔밥/계란국 중 계란국만 삭제/정정 불가.
- **스코프**: `NutritionFoodList` 확장 카드 각 item 옆 편집/삭제 버튼. `PATCH /api/food/[id]/items` 신설. items 개별 write 시 top-level 재산출 정책 필요 (v2.25.0 스케일 로직 재활용).
- **주의 (Codex P2)**: top-level kcal 이 바뀌면 그 날의 `DailySummary.estimatedIntakeCalories` / `calorieBalance` 도 stale. 기존 whole-log PATCH (`src/app/api/food/[id]/route.ts:206-223`) 는 `recalculateCalorieBalance` 호출 + 실패 시 `markStaleRecalcDate` 로 큐잉. 새 items endpoint 도 동일 후처리 포함 필수.
- **주의 (Codex P2 재재재재지적, null propagation)**: `FoodItemBreakdown` 은 모든 numeric field (kcal/proteinG/carbsG/fatG) null 허용. items endpoint 가 top-level 재산출 시 field-by-field 정책 필요 (기존 `estimate-nutrition.ts` 정책과 정합):
    - 모든 items 의 필드가 non-null → `top[field] = sum` (0.1 단위 round).
    - 어느 item 이라도 필드 null → `top[field] = null` (부분 미측정 propagate).
    - Zero-summing null 은 undercount 유발이라 금지. 기존 값 유지도 stale 라 금지.
    - Top-level null 결과이면 backfill 큐에 재진입. **`nutritionAttempts` 는 리셋** (Round 18 Codex P2 재재재재재지적: `runFoodKcalBackfill` (`backfill.ts:58-74`) 는 kcal-present macro-partial 행에서 attempts >= MAX 이면 excluded. terminal 상태 row 는 사용자 편집으로 null 생겨도 재진입 못함. items 편집은 **user-induced new estimation context** 이므로 attempts 새로 부여 정당). 원래 spec 이 "이력 유지" 로 잘못 명시된 것 정정.
- **주의 (Codex P2 재지적)**: items 는 whole-array JSON write 라 concurrent item edit or backfill 과 race → silent overwrite. 기존 `applyKcalCorrection` 은 `FoodLog.updatedAt` snapshot (client 는 `expectedRevision` 전달) 로 409 conflict 반환. items endpoint 도 동일 conditional-update 계약 필요 (client 가 draft 편집 열 시점 updatedAt 전송 → server updateMany where updatedAt 매칭).
- **주의 (Codex P2 재재지적, backfill 쪽 race)**: endpoint 만 revision guard 해도 `backfill.ts:442-449` 의 update 는 description/mealType/kcal/macros 스냅샷만 사용해 `updatedAt` 미포함. 사용자 item rename or derived total 변경 없는 편집 시 stale backfill 이 endpoint 성공 후 덮어씀. **backfill update 절에도 `updatedAt` snapshot 매칭 추가** 필요.

### B-4. Estimator provenance 저장 + Items 별 source 표시
- **배경**: 현 `FoodLog` 스키마에는 source 필드가 **없음** (사전 리뷰 지적). estimator notes 는 응답으로만 전송되고 저장 안 됨. 개별 item 이 어느 source 에서 왔는지 알 수 없음.
- **스코프**:
  1. **Schema 확장** (Codex P2 재³재지적: repeat semantic 은 log 단위):
     - **Item 단위** (`FoodItemBreakdown` JSON): `source: "mfds" | "ai" | "vision" | "manual" | null` — 원본 estimator. `manual` = 사용자가 B-3 items 편집으로 name/값을 직접 정정한 경우 (Codex P2 재⁵지적). null = legacy fallback.
     - **Log 단위** (`FoodLog` 신규 컬럼): `repeatComponents: String[] @default([])` (Postgres text array) — repeat-lookup 에서 재사용된 component 를 명시 저장 (예: `["kcal"]`, `["kcal","macros"]`, `["items"]`, `[]`). Round 12 지적 (backfill 이 어떤 component 대체했는지 track 해야 정확한 badge 판정) 대응. items null legacy source row 도 log-level 컬럼이라 저장 가능. Prisma migration 필요 (`ALTER TABLE "FoodLog" ADD COLUMN "repeatComponents" TEXT[] NOT NULL DEFAULT '{}'::TEXT[]`).
     - `viaRepeat` 는 **derived** — DB 컬럼 아니라 `repeatComponents.length > 0` 로 read-time 계산 (server 응답 shape 에 편의 필드). Persistent 상태는 `repeatComponents` 하나만.
     - 예: MFDS 로 처음 계산 + 오늘 재기록 = `items[i].source="mfds"`, `log.repeatComponents=["kcal","macros","items"]`, UI 는 viaRepeat=true (derived) → "재사용" 뱃지.
     - `source` 를 "repeat" 로 세팅하면 원본 estimator 정보 loss + repeat 뱃지 unreachable 방지.
  2. **Write 경로 7곳 propagate** — 모두 `repeatComponents: string[]` 배열을 add/remove 로 관리 (Round 15 Codex P2 재¹¹지적: 스키마 fix 후 viaRepeat 컬럼 없으므로 "viaRepeat=true/false" 세팅 문구는 정합 안 됨):
     - **Creation paths** (`POST /api/food` JSON + photo, `bot/food.ts`, `bot/food-photo.ts`): 각 estimator 결과에 items[i].source 태그 (mfds/ai/vision). Repeat hit 채택 시 채택된 component 를 `repeatComponents` 에 append (예: kcal 만 재사용 = `["kcal"]`, kcal + macros + items 재사용 = `["kcal","macros","items"]`). Hit 발생만으로 append X, 실제 채택 (rejected partial 은 미채택).
     - **Backfill** (`backfill.ts`): repeat hit 이 새로 채택되면 add. 반대로 MFDS/AI 로 replace 한 component 는 `repeatComponents` 에서 remove (예: MFDS 가 macros/items 만 replace 시 `remove(["macros","items"])`). kcal 은 backfill 이 그대로 두므로 `"kcal"` 는 유지 → badge 유지.
     - **applyKcalCorrection** (3 callers: PATCH `/api/food/[id]`, bot `/food_kcal`, bot reply): kcal 이 사용자 값으로 대체 + top-level macros rescale + items rescale → `repeatComponents.remove(["kcal","macros","items"])` (Codex P2 재¹²지적: rescaled top-level macros 도 사용자 파생이라 macros 제거 필수). rescaled items 는 `source="manual"` 로 write. Helper 갱신 필요.
     - **Replacement paths** (`PATCH /api/food/[id]` description/mealType 변경, `bot/food-edit-callback.ts:364-376`): kcal/macros/items/attempts 리셋 시 `repeatComponents = []` (컨텍스트 완전 갱신).
     - **kcal blanking** (`PATCH /api/food/[id]` `estimatedKcal:null` branch, `route.ts:123-129`): kcal/macros/items/attempts 클리어 시 `repeatComponents = []`.
     - **Manual item edit** (B-3 items endpoint): 사용자가 정정한 items 는 `source="manual"`. items 편집 시 top-level kcal/macros 도 rederive → `repeatComponents.remove(["kcal","macros","items"])` (Codex P2 재¹³지적: per-item lineage 는 component-level flag 로 정확히 판정 불가 — 예: original source="manual" (legacy/이전 편집) item 이 B-3 로 재편집된 것과 여전히 reused 상태를 구별 못함. Coarser atomic policy 로 items endpoint 진입 시 무조건 `"items"` 제거. 편집 대상이 아닌 reused item 이 남아도 endpoint 세션 자체가 items 컨텍스트를 "manual override" 로 바꾸므로 semantics 일관).
  3. **Helper 확장 (Codex P2 재지적)**: `src/lib/nutrition/food-items.ts` 의 `sanitizeFoodItemBreakdown` 과 `scaleItemsForNewKcal` 이 지금은 5 known field (name/kcal/P/C/F) 만 map/reconstruct — 그대로 두면 repeat lookup sanitize · hit.kcal 스케일 · backfill retained kcal 스케일 모두에서 source 필드 loss. 두 helper 도 source passthrough 로 수정 필요 (source 미제공/null 이면 그대로 통과, invalid enum 값이면 null 로 normalize).
  4. **UI 확장**: `NutritionFoodList` items breakdown 각 row 에 source 배지 (MFDS: 파랑, AI: 노랑, Vision: 초록, Manual: 주황, **null / 미제공: "출처 미상" 회색 뱃지**). legacy row (source null) 도 breakdown 자체는 정상 표시. 카드 헤더 (log 단위) 에 `log.repeatComponents.length > 0` (= derived viaRepeat true) 이면 "재사용" 배지 별도 노출.
  5. **회귀 테스트**: `scripts/test-food-items-sanitize.ts` 에 source 보존 · null 통과 · invalid normalize 케이스 추가. legacy shape (source 필드 자체 없음) 이 sanitize 통과 검증.
- **주의**: 스키마 · write path · helper · UI · 테스트 5단 변경. 우선순위 B 유지하되 스코프 큼. legacy row 하위호환 정책 (source optional + null fallback) 이 스코프 확정의 핵심.

### B-5. MCP `weight-loss` items 노출
- **배경**: v2.25.0 items 저장했지만 MCP tool 응답에는 총합만 들어감. AI 어드바이저가 세부 조언 불가.
- **스코프**: `src/mcp/tools/weight-loss.ts` payload 에 items[] 추가. Prompt injection 방어 (name 필드 필터).

---

## 우선순위 C (UX 개선)

### C-1. 주간 러닝 목표 미달 알림
- **배경**: v2.25.0 "이번 주 X km / 목표 Y km" 진행률 표시. 미달 시 사용자 알림 없음.
- **스코프**: 주간 리포트 (월요일 07:00 KST, `src/bot/notifications/scheduler.ts:90-98`) 에 "지난 주 목표 미달 N km" 문구 추가. `weekly-report.ts` + `personal-goals.ts` 로직 확장.
- **주의 (Codex P2)**: 현재 `computePersonalGoals` 는 `currentWeekKm(now)` (이번 주 = 월요일 07:00 이면 0) + `completedWeeksAvgKm(4)` (4주 avg) 만 노출. 지난 주 정확한 shortfall 을 뽑으려면 `previousCompletedWeekKm()` 신규 헬퍼 필요 (`weekStartKST(1, now) ~ startOfWeekKST(now)` 러닝 총합). `PersonalGoalsProgress.targetWeeklyKm` shape 에 `lastWeekKm` 필드 추가.
- **주의 (Codex P2 재재재지적)**: shape 확장만으로는 리포트 prompt 노출 안 됨. 리포트 pipeline: `askAdvisor` → `buildDynamicContext()` → `formatGoalsForPrompt` (`src/lib/personal-goals.ts`) 가 현재 currentWeek + 4주 avg 만 emit. **`formatGoalsForPrompt` 도 lastWeekKm 문구 추가 필수** (또는 리포트가 `get_personal_goals` MCP tool 를 명시 호출해서 raw shape 참조). 어느 쪽이든 스코프에 명시.
- **주의 (Codex P2 재재지적)**: `completedWeeksAvgKm` 은 empty 결과에 null 반환. `previousCompletedWeekKm()` 이 같은 관례 따르면 사용자가 지난 주 0km 뛰었을 때 alert 발동 안 됨 → 최대 미달을 놓침. **empty week = `0` 반환** 명시적 contract. 리포트 로직도 lastWeekKm===0 case 를 "완전 미달 (0/{target} km)" 로 처리.

### C-2. 도넛 카드 "선택 날짜" 인지 개선
- **배경**: v2.26.0 도넛 "오늘" 뷰 하드코딩. 사용자가 과거 조회 시 도넛 label "오늘" 이 헷갈릴 수 있음 (뒤늦게 사전 리뷰에서 발견).
- **스코프**: A-2 와 함께 처리. 도넛 "오늘 · 2026-08-27" 스타일 label. 선택 날짜와 도넛 기준 date 를 명확히 병기.

### C-3. Lifestyle 페이지 직접 진입도 date-aware
- **배경**: v2.26.0 lifestyle 은 `?date=` 지원하지만 이 페이지 자체엔 date nav 없음. 사용자가 lifestyle 진입 후 다른 날짜 편집하려면 URL 수동 편집 or nutrition 페이지 우회.
- **스코프**: `TodayFoodSection` 헤더 옆에도 nav (또는 `NutritionDateNav` 재사용). 스코프 좁게: nutrition 링크가 primary entrypoint 로 유지될지 사용자 판단 필요.
- **주의 (Codex P2)**: `NutritionDateNav.navigateTo` 는 `/nutrition` pathname 하드코딩. lifestyle 페이지에서 재사용하면 매 클릭마다 lifestyle 벗어남 → 목적 실패. 재사용 접근 시 `basePath` prop (또는 `usePathname()` 기반 route-neutral) 로 리팩터 필요. 별도 컴포넌트 신설 (`DateNav` shared) 도 대안.

---

## 우선순위 D (기술 부채 · infra)

### D-1. Inspect script 세션 토큰 부작용
- **배경**: `scripts/inspect-garmin-weight.ts` 가 `getGarminClient()` 대신 fresh `new GarminConnect()` 사용 → 서버 측 토큰 rotation 가능성 (실제로는 auto-recovery 있어 문제 없었음). 사전 리뷰 관찰사항.
- **스코프**: `getGarminClient()` 재사용 or 실행 후 `client.exportTokenToFile(TOKEN_DIR)` 호출.

### D-2. body-composition sync 로그 세부화
- **배경**: v2.26.1 진단 시 pm2 log 은 "synced: N" 만 있어 skip 이유 확인 불가. 재발 시 진단이 어려움.
- **스코프**: `body-composition.ts` 에 verbose flag or DEBUG env 시 entry 별 (skip/update/create) 로그 출력.

### D-4. Security Audit 실행 실패 시 이슈 자동 생성 (?)
- **배경**: v2.27.4 로 파서는 fail-closed 가 됐지만, audit **실행 실패**는 워크플로우 실패(빨간 X + 알림)로만 드러난다. 취약점 발견 시에만 이슈가 생성된다.
- **판단 보류 근거**: 이 워크플로우는 2026-07-27 부터 실패가 시작돼 09-03 수정까지 **약 5.5주간** 방치됐다 (08-10 1회만 성공, 마지막 연속 실패는 08-17~09-03 = 17일 · 스케줄 4회). 그 사이 이슈(#266)도 이미 생성돼 있었다. 알림 채널을 늘리는 것이 해법이 아니라는 뜻. 실효 있는 대안(텔레그램 알림 연동 등)을 먼저 정할 것.
- **스코프**: 정한다면 `security-audit.yml` 에 `if: failure()` github-script 스텝 추가, 또는 기존 봇 알림 파이프라인 재사용.
- **출처**: #359 스펙 §7.

### D-3. Formal test framework 도입 (?)
- **배경**: 현 프로젝트는 `scripts/test-*.ts` 관례. lint/typecheck/build 는 있지만 unit/integration test runner 없음. 회귀 테스트 발견 시마다 스크립트 신설.
- **스코프**: vitest or jest 도입. 기존 `scripts/test-*.ts` 를 test suite 로 migration. CI 통합.
- **주의**: 규모 큰 변경. 사용자 명시 요청 시 착수.

---

## 진행 상태 인계 규칙

- 각 항목 착수 시 `- **Status**: 진행중 (이슈 #N, 브랜치 브랜치명)` 추가
- 완료 시 `- **Status**: 완료 (릴리즈 vX.Y.Z)` + 항목 자체를 이 파일 아래쪽 "완료" 섹션으로 이동
- 사용자 요청 시 새 항목 추가 (우선순위 결정)

---

## 완료 (참고)

### A-4. SpO2 표시 일관성 정리 (#338 후속)

- **Status**: 완료 (릴리즈 v2.27.0, 이슈 #341, PR #343)

- **배경**: #338 사전 리뷰 P0 지적 2건. 이번 스코프에서 후속으로 분리.
- **스코프 1 (surface 불일치)**: `src/app/page.tsx:88` 대시보드가 `todaySleep?.avgSpO2 ?? todaySummary?.avgSpo2` 로 수면 SpO2 결측 시 **주간 SpO2 로 대체**한다. #338 에서 MCP `_context` 와 system prompt 는 "null 이면 미측정 — 주간값으로 대체 판단 금지" 로 정했으므로, 미측정 야간에 대시보드는 주간값을 · 모닝 리포트는 "측정 없음" 을 보여 같은 날짜에 두 surface 가 어긋난다. 폴백 제거 or 카드 label 을 `SpO2 (주간)` 으로 분기.
- **스코프 2 (중복 포맷)**: `평균% (최저 N%)` 포맷이 `src/bot/commands/sleep.ts` 와 `src/app/sleep/[date]/sleep-detail-client.tsx` 에 각각 구현됨. `src/lib/format.ts` 로 `fmtSpO2(avg, lowest)` 승격해 공용화 (상세 페이지의 `"측정없음"` 분기는 AI 프롬프트 전용이라 옵션 인자로 분리).
- **주의**: 봇은 `src/bot/utils/formatter.ts` 를 쓰고 웹은 `src/lib/format.ts` 를 쓴다. 공용화 시 어느 쪽을 단일 소스로 삼을지 먼저 결정.

### A-5. 대시보드 월간 SpO2 트렌드 차트 라벨 (#341 후속)

- **Status**: 진행중 (이슈 #346, 브랜치 fix/346-1)

- **배경**: #341 사전 리뷰 참고 지적. 요약 카드는 `SpO2` / `SpO2 (주간)` 로 출처를 밝히게 됐는데, 같은 화면의 월간 트렌드 차트 (`src/app/dashboard-client.tsx:301-307`) 는 데이터가 100% `DailySummary.avgSpo2` (주간 측정) 인데 제목이 그냥 `SpO2` 다. 같은 화면에서 동일 라벨이 다른 측정 종류를 가리킨다.
- **스코프**: 트렌드 차트 제목을 `SpO2 (주간)` 으로 변경, 또는 `SleepRecord.avgSpO2` 시리즈로 교체/병기. 후자는 데이터 소스 변경이라 스코프가 커짐 — 먼저 라벨만 정정하는 쪽 권장.
- **주의**: v2.26.2 이전 기간은 `SleepRecord.avgSpO2` 가 전 기간 null 이었다. 백필 실행 여부에 따라 수면 시리즈로 교체 시 과거 구간이 비어 보일 수 있음.

### (백로그 외) 수면 SpO2 파싱 키 오타
- **Status**: 완료 (릴리즈 v2.26.2, 이슈 #338, PR #339)
- 실사용 제보로 발견 — 모닝 리포트가 매번 "SpO2 측정값 없음(null)". `dailySleepDTO.averageSpo2` 라는 존재하지 않는 키를 읽어 전 기간 NULL. 실제 키는 `averageSpO2Value`. 백필 스크립트에도 동일 오타가 있어 백필로도 복구 불가했음. `rawData` 보존 덕에 재싱크 없이 전 기간 복구.

### (백로그 외) 야간 SpO2 그래프
- **Status**: 완료 (릴리즈 v2.27.0, 이슈 #342, PR #343 · #345)
- `rawData.wellnessEpochSPO2DataDTOList` (야간당 260~463 포인트) 를 시계열 차트로. 스키마 변경 · 재싱크 없음.
