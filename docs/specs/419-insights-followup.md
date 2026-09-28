# [후속 #419] `/insights` 후속 — 제외 사유 문구 · 레이스 점 연도 색 · RSC 페이로드

- **작성일**: 2026-09-28
- **타입**: chore (P2)
- **이슈**: #419 (#397 사전 리뷰 info 7 · PR #417 Codex 2회차 P2 2건)
- **브랜치**: `fix/419-1` (dev → dev)
- **의존**: #397 (`src/lib/insights` · `InsightScatter`) · #425 (레이스 · 중앙값 계열)

## 1. 배경 (2026-09-28 실코드 재검증 — 세 항목 모두 유효)

1. **제외 사유 문구** — `usableRuns` 는 거리 · 페이스 없는 러닝 (트레드밀) 도 `dropped` 로 세는데 페이지 캡션은 "3km 미만 · 페이스 범위 밖 N건 제외" 만 말한다. 사유별 건수가 없어 트레드밀이 "페이스 범위 밖" 으로 읽힌다.
2. **레이스 점 연도 색** — 레이스는 `race` 단일 계열 (`#e5e5e5` 속 빈 점) 이라 여러 해의 레이스가 있으면 연도 범례와 색이 안 맞는다. A (효율) · E (HRR) 패널 공통.
3. **RSC 페이로드** — A (약 2,155점) · B (약 2,136점) 의 점마다 툴팁 문자열 2줄 + `/activities/<cuid>` href 를 서버에서 직렬화 (약 400~500KB · `force-dynamic`). 이슈의 기준은 **배포 후 실측** (콜드 1s 이내면 낮춤).

## 2. 목표

1. 캡션이 사유별 건수를 말한다: "러닝 N건 중 M건 (거리 없음 a · 3km 미만 b · 페이스 범위 밖 c 제외)". 0건인 사유는 생략.
2. 레이스 점의 윤곽이 **그 점의 연도 색**. 범례의 "레이스" 항목은 중립색 유지 (모양 = 속 빈 점 이라는 뜻만).
3. 페이로드는 **측정으로 판단** — 이 PR 에서는 구현하지 않고 측정 명령과 예상 효과를 §7 에 기록. 1s 를 넘으면 별도 이슈.

## 3. 요구사항

- [x] F1 `filter.ts` `usableRuns`: 반환에 `droppedBy: { noDistance, tooShort, paceOut }` 추가 (`dropped` 합계는 유지). 사유는 한 건에 하나 — 우선순위 거리 없음 > 3km 미만 > 페이스 범위 밖.
- [x] F2 `filter.ts` `describeDropped(droppedBy)`: "거리 없음 a · 3km 미만 b · 페이스 범위 밖 c" (0건 생략 · 전부 0 이면 빈 문자열). `page.tsx` `filterNote` 가 이것을 쓴다.
- [x] F3 `ScatterPoint.color?: string` — 점 단위 색 (계열 색 대신). `InsightScatter` `shape` 가 `payload.color ?? s.color` 로 윤곽 · 채움.
- [x] F4 `yearSeries` 를 `src/components/insights/year-series.ts` (순수) 로 분리. 레이스 점에 `color: yearColor(그 해)` · `toggleId` 유지. 범례 색은 그대로 `#e5e5e5`.
- [x] F5 회귀 테스트: `filter.test.ts` (사유별 건수 · 우선순위 · 문구) · `year-series.test.ts` (레이스 점 색 = 연도 색 · 비레이스 점은 색 없음 · 레이스 없으면 계열 없음 · toggleId).
- [ ] F6 페이로드 측정 명령 (§7) 을 이슈 댓글에 남긴다. 결과가 1s 초과면 별도 이슈 (원시값만 넘기고 툴팁은 클라이언트 조립).

## 4. 기술 설계

- `droppedBy` 는 `kept` 필터와 같은 조건을 한 번 더 도는 게 아니라 `reduce` 한 번으로 분류 (러닝 2,156행 · 무시할 비용이지만 한 곳에서 조건을 관리).
- `ScatterPoint.color` 는 선택 필드 — 기존 호출 (습도 · lag · 중앙값) 은 변경 없음. `shape` 의 세 분기 모두 `payload.color ?? s.color`.
- `yearSeries` 는 `yearColor` (`components/trends/year-colors`) 와 `ScatterSeries` 타입만 의존 → 순수 모듈. `page.tsx` 는 import 만 바뀐다.
- 디자인 단계: 기존 승인 시안 (`docs/designs/397-insights/`) 의 색 규칙 안에서 윤곽 색만 바뀌므로 새 시안 없이 스펙에 기록.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/insights/filter.ts` (+ `__tests__/filter.test.ts`) | `droppedBy` · `describeDropped` |
| `src/components/insights/year-series.ts` (+ `__tests__/year-series.test.ts`) | 신규 · 순수 (page.tsx 에서 이동 + 레이스 점 색) |
| `src/components/insights/InsightScatter.tsx` | `ScatterPoint.color` · `shape` |
| `src/app/insights/page.tsx` | `filterNote` · `yearSeries` import |
| `docs/specs/397-insights.md` | 후속 반영 표기 |

## 6. 테스트 계획

§3 F5. 4종 검증. 로컬 `next dev` 로 `/insights` 캡션 · 레이스 점 확인 (로컬 DB 는 2026-04 스냅샷 — 레이스 점 유무는 데이터에 달림, 없으면 단위 테스트로 대체).

## 7. 제외 사항 · 페이로드 측정

- **RSC 페이로드 축소는 이 PR 범위 밖** (이슈 기준: 배포 후 실측). 서버에서:
  ```bash
  # 콜드 (pm2 restart 직후) · 웜 각 1회 — TTFB 와 크기
  curl -s -o /dev/null -w 'ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download}\n' -u "$BASIC_AUTH" http://127.0.0.1:3000/insights
  curl -s -o /dev/null -w 'rsc bytes=%{size_download}\n' -u "$BASIC_AUTH" -H 'RSC: 1' http://127.0.0.1:3000/insights
  ```
- **예상 효과 (설계 메모)**: 점 하나가 지금 `{x, y, lines[2], href}` ≈ 110B. 툴팁 문자열을 클라이언트에서 조립해도 `id` (cuid 25자) · `ymd` · 원시값이 남아 ≈ 80B — **절반 이하는 문자열 이동만으로는 안 된다.** 절반을 넘기려면 `id` 를 빼고 (클릭 → `/activities/by-date/<ymd>` 같은 우회) 또는 gzip 을 전제해야 한다 (Nginx gzip 이면 반복 문자열이 이미 많이 줄어 실효는 더 작다). 측정값이 1s 안이면 종료.
- 존 · lag 패널의 툴팁은 점이 수십~수백 개라 대상 아님.
