# myFitness 로드맵

# 마일스톤 1 ✅ (2026-04-07 완료)

## Phase 1: Foundation

- [x] 프로젝트 초기화 + PM2 배포 설정
- [x] DB 스키마 설계 + Prisma 마이그레이션
- [x] Garmin Connect 연동 + 인증 (토큰 캐싱)
- [x] Garmin 데이터 싱크 엔진 (365일 히스토리)
- [x] 수동 싱크 API + 싱크 상태 관리

## Phase 2: Dashboard & Visualization

- [x] 레이아웃 + 네비게이션 (사이드바, 다크테마)
- [x] 대시보드 홈 (오늘 요약 + 주간 미니차트)
- [x] 러닝 활동 페이지 (목록, 상세)
- [x] 수면 페이지 (수면 단계, 점수 추세)
- [x] 심박/HRV + 체성분 페이지

## Phase 3: 자동 싱크 + 생활 패턴

- [x] Cron 자동 싱크 (3시간마다)
- [x] 일일 통계 대시보드 (30일 추세)
- [x] 생활 패턴 분석 페이지 (꾸준함 점수, 수면 규칙성)

## Phase 4: AI Advisor

- [x] MCP 서버 (6개 도구)
- [x] AI 어드바이저 엔진 (Claude CLI + 세션 유지)
- [x] AI 채팅 페이지 + 프리셋 5개

## Phase 5: 심화 분석

- [x] 러닝 실력 분석 (HR존, 페이스/VO2max 추세)
- [x] 트레이닝 로드 (주간 볼륨, 오버트레이닝 위험)
- [x] 다이어트 관리 (식단 입력, 칼로리 추정)

## Phase 6: 마무리

- [x] PWA, CSV 내보내기, 주간 AI 리포트

---

# 마일스톤 2: 상세 강화 + AI 고도화 + 텔레그램

## M2-1: DB 스키마 확장 + 싱크 보강 ✅

미활용 Garmin 데이터를 DB 컬럼으로 추출.

- [x] Activity: 러닝 다이나믹스, 유산소/무산소 TE, 호흡수, 스플릿
- [x] SleepRecord: SpO2, 호흡수, 수면 스트레스, 배터리 변화, HRV, 점수 세부
- [x] DailySummary: SpO2, 스트레스 세부, 호흡수, 배터리 충전/소모

## M2-2: AI 지표 평가 보완 + 모닝/이브닝 리포트 — 우선순위 ★★★

> AI 평가의 시간대 바이어스 해소가 다른 기능의 품질에 직접 영향.
> 활동/수면 상세의 AI 평가, 텔레그램 봇 리포트 전송 모두 이것에 의존.

- [x] MCP 도구 응답에 시간대 맥락(_context) 추가 (바이어스 방지)
- [x] 시스템 프롬프트 시간대별 지표 해석 가이드 강화
- [x] AIAdvice 스키마 reportDate 추가
- [x] 모닝 리포트 (08:00 KST): 수면/회복/운동추천
- [x] 이브닝 리포트 (23:00 KST): 하루정리/회복필요성
- [x] Cron 모닝/이브닝 스케줄
- [x] Reports API 확장 (type/date 필터, 수동 생성)
- [x] /reports 페이지 신규 (이력 + 수동 생성)
- [x] 대시보드 상단 리포트 요약 카드
- 스펙: `docs/specs/m2-daily-reports.md`

## M2-3: 활동 상세 페이지 강화 — 우선순위 ★★

> M2-1에서 추출한 데이터를 활동 상세에 시각화.

- [x] 러닝 다이나믹스 (케이던스, 보폭, 수직진동, 지면접촉시간)
- [x] 유산소/무산소 TE, 호흡수 표시
- [x] AI 평가 버튼
- [x] rawData backfill 스크립트
- [ ] km별 스플릿 차트 (활동 상세 API 추가 호출 필요 — 별도 이슈)

## M2-4: 수면 상세 페이지 신규 — 우선순위 ★★

> 개별 수면 기록의 심층 분석.

- [x] `/sleep/[date]` 상세 페이지
- [x] 수면 요약 + 단계 바 + 배터리 변화량
- [x] 수면 점수 세부 (총시간/스트레스/깨어남/REM/깊은/얕은)
- [x] 바이탈 지표 (SpO2, 호흡수, 수면 스트레스, 안정시 심박, HRV)
- [x] AI 평가

## M2-5: 기존 UI에 신규 지표 노출 — 우선순위 ★

> M2-1 데이터를 기존 페이지에 통합.

- [x] 대시보드: SpO2 카드 + SpO2 추세
- [x] 일일 통계: 스트레스 세부 분포
- [x] 심박 페이지: 호흡수 추세

## M2-6: 텔레그램 봇 — 우선순위 ★★★

> 모바일에서 빠른 조회 + 리포트 자동 수신의 핵심 채널.
> M2-2 리포트 시스템과 연동.

- [x] grammY + 별도 PM2 프로세스 (long polling)
- [x] 커맨드: /today, /run, /sleep, /weight, /sync, /report, /ai, /reset
- [x] 자연어: 식단 입력, AI 질문 감지
- [x] 모닝/이브닝/주간 리포트 자동 전송 (M2-2 의존)
- [x] 미들웨어 인증 (TELEGRAM_ALLOWED_CHAT_IDS)
- 스펙: `docs/specs/m2-telegram-bot.md`

## M2-7: km별 스플릿 차트 — 우선순위 ★

> 활동 상세에서 킬로미터별 페이스/HR/케이던스 시각화.
> 현재 splitSummaries는 구간 요약이라 km별 데이터 별도 조회 필요.

- [x] Garmin 개별 활동 API(getActivity) 조사 — /splits 엔드포인트에서 lapDTOs 제공
- [x] 활동 상세 접속 시 on-demand 조회 (GET /api/activities/[id]/splits)
- [x] km별 페이스 바 차트 + 상세 테이블
- [x] 백로그 코드 리뷰 이슈 P2 2건 + P1 4건 수정
- 스펙: `docs/specs/backlog-km-splits.md`

## M2-8: 날짜/타임존 정합성 + 리포트 안정화 — 우선순위 ★★★

> 싱크 시 미래 날짜 데이터 + 모닝 리포트 데이터 부정확 문제 해결.

- [x] 자동/수동 싱크 endDate → 오늘(KST), fetcher에서 미래 날짜 가드
- [x] garmin/utils.ts KST 날짜 유틸 통일 (nowKST, todayKST, yesterdayKST, daysAgoKST)
- [x] 모닝/이브닝 리포트 전 데이터 싱크 수행
- [x] 리포트 재생성 기능 (force 옵션, 재생성 버튼, 텔레그램 /report regenerate)
- 스펙: `docs/specs/m2-8-date-fix.md`

---

# 마일스톤 4: 체중감량 + 정확한 강도 분석

## 배경
- 사용자: 칼로리 목표 1890kcal/일, 최대심박 176, LTHR 157, 체중감량 진행 중
- 현재 문제: 최대심박/LTHR 미저장 → Zone 분석 부정확, 식단 데이터 없음 → 칼로리 밸런스 불가

## M4-1: 최대심박수/LTHR 저장 및 활용 ✅

- [x] UserProfile에 maxHR, lthr, lthrPace 필드 추가
- [x] 프로필 편집 UI (maxHR, LTHR 입력)
- [x] Zone 계산 로직 LTHR 기반으로 변경
- [x] 리포트 프롬프트에 개인 Zone 정보 주입
- 효과: 모든 리포트 강도 분석 정확화
- 스펙: `docs/specs/m4-1-maxhr-lthr.md`

## M4-2: 칼로리 밸런스 필드 추가 ✅

- [x] DailySummary에 estimatedIntakeCalories, availableCalories, calorieBalance 추가
- [x] 계산 로직: 섭취가능 = 목표(1890) + 활성칼로리
- [x] UserProfile에 targetCalories 필드 추가 (M4-1에서 완료)
- 효과: 체중감량 진행도 명확화
- 스펙: `docs/specs/m4-2-calorie-balance.md`

## M4-3: 식단 데이터 연동 (Garmin 경유 조사) ✅

- [x] Garmin Connect API에 식단/영양 데이터 존재 여부 조사
- [x] MFP 연동 시 Garmin에 데이터 내려오는지 테스트 스크립트
- [x] 결과: consumedKilocalories=null, includesCalorieConsumedData=false (MFP 미연동)
- [x] 보너스: netCalorieGoal(1890) 발견 → targetCalories 자동 싱크 구현
- [ ] 사용자 확인: MFP ↔ Garmin 연동 활성화 후 재조사 (백로그)
- 스펙: `docs/specs/m4-3-diet-sync.md`

## M4-4: Split/Lap 데이터 MCP 도구화 ✅

- [x] get_activity_splits MCP 도구 추가
- [x] Lap별 거리, 시간, 페이스, 심박, 케이던스, 강도 타입 반환
- [x] AI 러닝 분석 시 스플릿 수준 분석 가능
- [x] Claude allowedTools + get_activities에 ID 노출 (AI 실제 사용 가능)
- 스펙: `docs/specs/m4-4-splits-mcp.md`

## M4-5: 운동 강도 자동 분류 ✅

- [x] Activity에 zoneDistribution, estimatedZone, intensityScore, intensityLabel 필드 추가
- [x] LTHR 기반 자동 분류 로직 (실측 LTHR 있을 때 보정)
- [x] Garmin hrTimeInZone_1~5 (rawData)에서 HR zone 분포 직접 추출
- [x] 활동 상세 UI + MCP get_activities 응답에 반영
- 스펙: `docs/specs/m4-5-intensity-classification.md`

## M4-6: 체중감량 진행 대시보드 ✅

- [x] 기존 `/body` 페이지에 통합 확장
- [x] 체중 7일/14일 이동평균 차트 (달력일 기준)
- [x] 칼로리 밸런스 일별 바 차트 (결손/잉여)
- [x] 주간 요약 테이블 (평균 결손, 예상/실제 감량)
- [x] 주간 러닝 거리 8주 차트 + 목표 진행도 카드
- [x] UserProfile.targetDate 필드 + 프로필 UI 지원
- 스펙: `docs/specs/m4-6-weight-loss-dashboard.md`

## M4-7: 체지방률 트래킹 ✅

- [x] BodyComposition.source 필드 ("garmin" | "manual") + CHECK 제약
- [x] 수동 입력 모달 UI (/body 페이지) + POST /api/body-composition
- [x] Garmin 싱크 시 manual 레코드 원자적 보호 (updateMany + P2002 catch)

## M4-8: 영양소 상세 분석 — 우선순위 ★ (중간, M4-3 의존)

- [ ] 단백질/탄수화물/지방 일일 추적
- [ ] 매크로 밸런스 시각화
- [ ] 근손실 방지 경고 (단백질 부족 시)

## M4-9: AI 리포트 고도화 — 우선순위 ★ (중간)

- [ ] 식단 + 운동 + 수면 통합 평가
- [ ] 칼로리 부족 + 고강도 운동 조합 시 근손실 위험 경고
- [ ] LTHR 기반 강도 피드백 (M4-1 의존)

## M4-10: 활동 상세 페이지 고도화 — 우선순위 ★ (중간)

- [ ] Split 데이터 시각화 강화
- [ ] 러닝 다이나믹스 그래프
- [ ] HR Zone 분포 도넛/바 차트 (M4-5 의존)

---

### 권장 진행 순서

```
1. M4-1 (LTHR 저장) — 빠른 승리, 30-45분
2. M4-2 (칼로리 밸런스 필드) — 30분
3. M4-3 (식단 연동 조사) — 2-3시간, 복잡도 높음
4. M4-4 (Split MCP) — 1시간
5. M4-5 (강도 분류) — 1-2시간
6. M4-6 (대시보드) — 복잡도 높음
7. M4-7 ~ M4-10 — 순차 진행
```
