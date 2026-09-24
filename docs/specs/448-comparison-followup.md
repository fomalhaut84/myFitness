# [M17 후속] 활동 AI 평가 비교 후속 — 같은 코스 이전 기록을 매처 안으로 · 제외 집합 전체 · 1km 라벨

- **작성일**: 2026-09-24
- **타입**: chore (Codex P2 후속 — PR #446 2회차 3건)
- **이슈**: #448
- **브랜치**: `fix/448-1`
- **의존**: #440 (`activity-eval`) · #261 (`findSimilarActivities`). 스키마 · 패키지 변경 없음.

## 1. 배경

PR #446 Codex 2회차 P2 3건 — 전부 엣지 (과거 활동 평가 · 같은 코스가 30건 이상 · 1km 랩 페이스 결측).

1. `load.ts` 가 같은 코스 후보 30건을 받은 뒤 **이전** 기록만 남기고 10건 상한 — 이후 기록이 30건 이상인 코스 (오래된 활동을 평가) 에서 기준선이 빈다.
2. 비슷한 거리의 제외 집합이 표시용 같은 코스 10건뿐 — 11번째 이후 같은 코스 기록이 "비슷한 거리" 로 다시 들어간다.
3. `firstKmDeltaSec` 이 "첫 **페이스 있는** 랩" 기준 — 1km 랩 페이스가 결측이면 2km 를 첫 km 로 말한다.

## 2. 요구사항

- [ ] F1 `findSimilarActivities(id, { before?: Date })` — 태그 · GPS 두 쿼리 모두 `startTime < before` 를 DB 에서 건다 (`candidateTimeRange` 순수 함수). `load.ts` 는 `before: row.startTime` 으로 호출하고 후처리 필터 · `SAME_COURSE_CANDIDATES` 를 제거.
- [ ] F2 제외 집합 = **이전 같은 코스 전부** — 매처를 표시 상한이 아니라 스캔 상한 (`SAME_COURSE_SCAN`) 으로 부르고, 순수 `selectComparisons(sameCourse, similar)` 가 표시 10건 + 전체 id 제외를 담당.
- [ ] F3 `LapSummary.firstKmPaceSecPerKm` (1km 랩 = `kmIndex 1` 에 페이스가 있을 때만) · `firstKmDeltaSec` 도 같은 조건. `splitLines` 의 "첫 km" 문장은 그 값으로 (첫 페이스 있는 랩을 찾던 `firstPace` 제거).
- [ ] F4 회귀 테스트 3건 — `candidateTimeRange` (before 가 창 끝을 자름) · `selectComparisons` (11번째 이후 같은 코스가 비슷한 거리에 안 들어감) · `summarizeLaps` (1km 페이스 결측 → 첫 km null · 문장 없음).

## 3. 제외

- 비교 상한 (10건) · 창 (±2년) 자체의 변경.
