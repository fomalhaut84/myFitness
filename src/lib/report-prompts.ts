// #444 F5~F8: 리포트 프롬프트 정본 — 순수 문자열 (prisma · 싱크 없음) 이라 vitest 가 도구 명시를 회귀 검사한다.
// #203 선례: 자연어만 두면 Sonnet 이 도구 호출을 건너뛴다 → 도구 이름 · 인자를 명시한다.
import { ymdKST } from "@/lib/garmin/utils";

export const MORNING_PROMPT = `모닝 리포트를 작성해줘.

어젯밤 수면 데이터와 현재 회복 상태를 분석하고, 감량 진행도를 포함해줘:
- 수면 점수, 수면 단계별 시간 (깊은/얕은/REM/깨어남)
- SpO2, 호흡수, 야간 HRV
- 기상 시 바디배터리 (bodyBatteryHigh 기준)
- 수면 중 안정시 심박수
- 바디배터리 충전량으로 회복 상태 평가
- 어제 칼로리 밸런스 (get_weight_loss_status 도구로 조회): 결손/잉여 평가 + 주간 추세
- 체중 추세: 최근 7일 변화, 감량 페이스가 적정(주 0.5kg)인지
- 혈압: mcp__myfitness__get_blood_pressure(days=7) 로 조회 — 측정이 있으면 7일 평균과 시스템 프롬프트의 혈압 경고 규칙을 적용, 측정이 없으면 항목 자체를 생략
- 오늘의 운동 추천: mcp__myfitness__recommend_today_workout() 결과를 근거로 (회복 상태 + 칼로리 밸런스 고려, Zone 기반 강도 제안)
- 경고 규칙에 해당하면 반드시 경고 포함
- **개인 목표 진행 상황** (컨텍스트에 "개인 목표" 섹션이 있을 때만): 각 목표별 현재 vs 목표 gap/진행률 한 줄 언급

간결한 마크다운으로 작성.`;

export const EVENING_PROMPT = `이브닝 리포트를 작성해줘.

오늘 하루의 활동 데이터를 정리하고, 강도 분석과 칼로리 밸런스를 포함해줘:
- 오늘 운동 기록이 있으면 분석 (거리, 페이스, HR, TE, intensityLabel, Zone 분포)
- 오늘 러닝이 있으면 활동마다 mcp__myfitness__get_activity_context(activityId) 를 호출해 (activityId 는 get_activities 응답의 id 또는 garminId) km 스플릿 · 종료 후 회복 (2분 HRR) · 같은 코스/비슷한 거리 비교까지 근거로 분석. 환경 섹션의 기상 (기온 · 습도 · 바람) 이 페이스/심박에 준 영향을 한 줄로
- 오늘 러닝이 있으면 mcp__myfitness__get_personal_records() 를 호출해 오늘 활동의 id/ymd 가 byBucket · longest · bestHrr2 와 같으면 신기록 축하 한 줄 (아니면 항목 생략)
- 걸음 수, 활동 칼로리
- 오늘 칼로리 밸런스 (결손/잉여, 섭취 vs 섭취가능) — get_weight_loss_status로 조회
- 스트레스 분포 (고/중/저 비율)
- 바디배터리 소모량 (bodyBatteryDrained) vs 충전량 (bodyBatteryCharged) 비교
- 취침 전 회복 필요성 평가 (고강도 운동 후 회복 경고 규칙 확인)
- 내일 운동 계획 제안 (Zone 기반, 칼로리 밸런스 고려)
- 경고 규칙에 해당하면 반드시 경고 포함
- **개인 목표 진행 상황** (컨텍스트에 "개인 목표" 섹션이 있을 때만): 오늘 훈련이 목표 (평균 페이스/주간 거리/체중 등) 에 어떻게 기여했는지 한 줄 코멘트

간결한 마크다운으로 작성.`;

/** 이번 주 창 — 도구는 오늘 포함 (days+1) 일이라 7일은 days=6 */
export const WEEKLY_CURRENT_DAYS = 6;
/** 직전 4주 창 폭 — endDate 와 함께 써서 이번 주를 제외 (PR #453 Codex P2) */
export const WEEKLY_BASELINE_DAYS = 27;
const BASELINE_OFFSET_DAYS = 7;
const DAY_MS = 86_400_000;

/** 직전 4주 창의 끝 = 오늘 (KST) − 7일. `get_activities(days=27, endDate=…)` 가 [오늘−34, 오늘−7] 을 본다 */
export function weeklyBaselineEndDate(now: Date = new Date()): string {
  return ymdKST(new Date(now.getTime() - BASELINE_OFFSET_DAYS * DAY_MS));
}

/**
 * 주간 리포트 프롬프트. `baselineEndDate` 는 `weeklyBaselineEndDate()` — 모델이 날짜 산술을 하지 않게 구체 날짜를 박는다.
 */
export function buildWeeklyReportPrompt(baselineEndDate: string): string {
  return `이번 주 피트니스 데이터를 종합 분석해서 주간 리포트를 작성해줘.

## 반드시 아래 MCP 도구를 먼저 호출해 최신 데이터를 수집한 후 리포트 작성

(주의: 대부분 도구는 내부에서 \`since = daysAgo(days)\` + inclusive \`gte\` 로 계산되어
"오늘 포함 (days+1) 일" window. 정확한 7일 window 는 \`days=${WEEKLY_CURRENT_DAYS}\`. 예외: get_blood_pressure
는 \`days\` 를 display window length 로 그대로 사용 → 7일 원하면 \`days=7\`.
endDate 없는 창은 오늘을 포함하므로, 직전 4주 기준선은 반드시 endDate 를 줘서 이번 주를 제외한다.)

- mcp__myfitness__get_activities(days=${WEEKLY_CURRENT_DAYS}, type="running") — 이번 주 (최근 7일) 러닝 활동 목록 + runningSummary (존 분포 80/20 · 2분 HRR 중앙값)
- mcp__myfitness__get_activities(days=${WEEKLY_BASELINE_DAYS}, endDate="${baselineEndDate}", type="running") — 직전 4주 기준선 (이번 주 제외) 의 runningSummary
- mcp__myfitness__get_sleep(days=${WEEKLY_CURRENT_DAYS}) — 최근 7일 수면 추세 (점수, 시간)
- mcp__myfitness__get_heart_rate(days=${WEEKLY_CURRENT_DAYS}) — 최근 7일 심박/HRV 추세
- mcp__myfitness__get_daily_stats(days=${WEEKLY_CURRENT_DAYS}) — 최근 7일 걸음, 활동 칼로리, 스트레스
- mcp__myfitness__get_trends(period="week") — 전반 트렌드
- mcp__myfitness__get_training_load_trend() — 훈련 부하 추세
- mcp__myfitness__get_weight_loss_status() — 칼로리 밸런스 주간 요약
- mcp__myfitness__get_pace_progression() — 페이스 발전 추세
- mcp__myfitness__get_injury_risk_score() — 부상 위험도
- mcp__myfitness__get_blood_pressure(days=7) — 최근 7일 혈압 (시스템 프롬프트 주간 BP 경고 규칙 필수)
- mcp__myfitness__get_fitness_metric_trend(days=13, granularity="daily") — 최근 2주 VO2max 일별 · 젖산역치 감지 (이번 주 변화 판단)
- mcp__myfitness__get_active_training_plan() — 활성 훈련 플랜 (없으면 플랜 항목 생략)
- mcp__myfitness__get_personal_records() — 전 기간 개인 기록 (이번 주 날짜의 신기록 판단)
- mcp__myfitness__get_body_composition(days=27) — 체지방 · 근육량 (값이 있는 주만)

기억이나 추측이 아닌 위 도구 결과의 실제 수치만 인용.

## 리포트 항목 (마크다운, 간결하게)

1. 주간 운동 요약 (러닝 횟수, 총 거리, 평균 페이스, 강도 분류별 횟수)
2. 존 분포 80/20: 이번 주 runningSummary.easyPct (Z1+Z2 시간 비율) vs 직전 4주 — 80% 안팎이 polarized 기준. 존 있는 활동 수 (withZones) 가 적으면 그렇다고 명시
3. 2분 HRR: 이번 주 runningSummary.hrr2.median vs 직전 4주 (양수 = 회복 · 클수록 좋음). 둘 중 하나라도 null 이면 비교 대신 "측정 없음"
4. VO2max 변화 · 젖산역치 감지 (get_fitness_metric_trend): 이번 주 값이 바뀌었으면 언급, 아니면 한 줄로 "변화 없음"
5. 플랜 준수율 (활성 플랜이 있을 때만): 이번 주 completed / missed 와 준수율 %
6. 신기록 (get_personal_records 의 byBucket · longest · bestHrr2 · bestVo2max 의 ymd 가 이번 주면): 항목별 한 줄 축하. 없으면 항목 생략
7. 러닝 다이나믹스 추세: 이번 주 vs 직전 4주 runningSummary.dynamics (케이던스 · 접지시간 GCT · 보폭 · 수직진동) — 케이던스 하락 · GCT 상승은 피로/부상 신호. n 이 적으면 그렇다고 명시
8. 활동 강도 분: get_daily_stats totals.weightedIntensityMinTotal (중강도 + 고강도×2) vs WHO 권고 150분/주 — 중강도 · 고강도 분을 함께 적는다. weighted 가 null 이면 totals.intensityMinTotal (단순합) 을 "최소" 로만 언급하고 150 과 비교하지 않는다. 오른 층수 합 한 줄
9. 수면 분석 (평균 수면 시간, 수면 점수 추세) + 수면 규칙성: get_sleep regularity (취침 평균 시각 · 표준편차 · label)
10. 심박/HRV 트렌드 (피로도 판단)
11. 컨디션 종합 평가 (바디배터리, 스트레스)
12. 칼로리 밸런스 주간 요약: 평균 결손/잉여, 감량 페이스 평가, 체중 변화 (7일 이동평균). 체지방 · 근육량은 get_body_composition 에 값이 있는 주만 추세 한 줄 (없으면 생략)
13. 경고 사항 (시스템 프롬프트의 경고 규칙에 해당하면 반드시 포함)
14. 다음 주 추천 사항 (Zone 기반 훈련 배분 + 칼로리 밸런스 관리)
15. **개인 목표 진행 상황** (컨텍스트에 "개인 목표" 섹션이 있을 때만): 이번 주 진행도 (평균 페이스/주간 거리/체중 등) + 다음 주 목표 접근 전략`;
}
