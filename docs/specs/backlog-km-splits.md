# [백로그] km별 스플릿 차트

## 배경

현재 Garmin `getActivities()` API의 `splitSummaries`는 km별이 아닌 구간 요약(RWD_WALK, INTERVAL_ACTIVE, RWD_RUN)으로 제공됨. km별 페이스/HR/케이던스 차트를 구현하려면 개별 활동 상세 API가 필요.

## 필요 작업

1. **Garmin 개별 활동 API 조사**: `getActivity(activityId)` 응답에 km별 splits 포함 여부 확인
2. **싱크 시 추가 호출**: 활동 싱크 시 상세 API를 추가 호출하여 km별 데이터 저장
   - Rate limit 고려 (활동당 1회 추가 호출)
   - 또는 상세 페이지 접속 시 on-demand 조회
3. **스플릿 차트 구현**: km별 페이스 바 차트 + 테이블

## 참고

- rawData에 `fastestSplit_1000`, `fastestSplit_1609`, `fastestSplit_5000` 필드 있음 (최고 기록만)
- 현재 splitSummaries 구조: `[{splitType: "INTERVAL_ACTIVE", distance: 7320, ...}]` (총 구간 요약)
- km별 데이터는 Garmin Connect 웹에서 "Splits" 탭에서 제공하는 것과 동일한 데이터 필요

## 우선순위

낮음 — 현재 러닝 다이나믹스/TE/AI 평가로 상세 분석은 가능. 추후 개선.
