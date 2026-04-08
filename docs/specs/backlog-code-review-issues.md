# [백로그] 코드 리뷰에서 발견된 기존 코드 이슈

## P2: 수면 시간 타임존 (fmtTime/formatTime)
- `new Date(isoStr).getHours()`가 서버/클라이언트 타임존에 의존
- sleepStart/sleepEnd가 GMT 타임스탬프인데 로컬 시간으로 표시 중
- ISO 문자열에서 HH:MM을 직접 추출하거나 KST 명시 필요

## P2: 하드코딩된 estimatedMaxHR=190
- HR존 계산에 190 고정값 사용
- UserProfile에서 나이 기반 계산(220-age) 또는 사용자 설정 필요

## P1: bodyBatteryChange 음수 시 "+-5" 표시
- 수면 상세에서 `+${value}` 고정 → 음수 조건 처리 필요

## P1: 월간 러닝 요약 타임존
- `monthStart`가 서버 로컬 midnight → KST 기반으로 변경 필요

## P1: 월간 평균 페이스 산술평균
- 거리 가중 평균으로 변경 필요 (짧은 러닝이 평균을 왜곡)

## P1: weeksAgo(8) vs 7주 루프 불일치
- DB 쿼리 범위가 루프보다 넓음 (56일 vs 49일)
