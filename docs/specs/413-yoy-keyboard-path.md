# [후속 #413] `/trends` YoY 뷰 키보드 · 스크린리더 경로 — 월별 값 · 링크 표

- **작성일**: 2026-09-28
- **타입**: chore (P2 · 접근성)
- **이슈**: #413 (#396 사전 리뷰 info 13)
- **브랜치**: `fix/413-1` (dev → dev)
- **의존**: #395 (`YoyChart`) · #396 (포인트 클릭 → `/history` 월 뷰)

## 1. 배경 (2026-09-28 실코드 재검증 — 유효)

`/trends` 의 포인트 클릭 (시계열 · YoY · 계절성) 은 Recharts SVG 요소의 `onClick` 이라 마우스 · 터치 전용이고 차트는 `role="img"` 라 AT 에서 자식이 보이지 않는다. 시계열 · 계절성은 판독값 띠 (`ReadoutRow`) 의 링크가 키보드 경로지만 **YoY 뷰에는 판독값 띠가 없어 대체 경로가 0** 이다 (`YoyView` 는 차트 + 연도 토글 + 범례 문구뿐).

## 2. 목표

YoY 뷰에 차트와 같은 정보를 **글자와 링크**로 주는 대응물 하나 — 연도 × 12개월 표. 각 칸은 값 + `/history/YYYY/MM?metric=` 링크 (`<a>`). 기본은 접혀 있어 (`<details>`) 시각 사용자의 화면을 바꾸지 않는다.

## 3. 요구사항

- [x] F1 `src/lib/history/yoy-links.ts` (순수): `yoyLinkRows(pivot, metricId)` → 연도 내림차순 × 12개월 `{ month, value, partial, lowCoverage, href }`. 값 없는 달은 `value: null` · `href: null`. href 는 `historyMonthPath` + `historyMetricQuery` (차트의 점 클릭과 같은 경로).
- [x] F2 `src/components/trends/YoyMonthTable.tsx` (서버 컴포넌트): `<details>` "월별 값 · 링크" 안에 `<table>` — 열 헤더 1~12월 · 행 = 연도 · 칸 = `<a>` (값 · 미완결 달은 `*` 와 `title`) 또는 `—`. `ValueTable` 톤 · 폰은 가로 스크롤. `aria-label` 로 지표 이름.
- [x] F3 `YoyView` (`src/app/trends/page.tsx`): 차트 · `Keys` 아래에 표. 차트가 없을 때 (`hasUsable` false) 도 값이 있으면 표는 보인다 (절반 미만 달만 있어도 링크는 유효).
- [x] F4 회귀 테스트 `yoy-links.test.ts`: 연도 정렬 · 12칸 · href 형식 · 기본 지표는 쿼리 생략 · 값 없는 달 null.
- [x] F5 스펙 396 §3 F16~F18 ↳ · 디자인 노트 "구현 시 시안과 달라지는 것" 갱신.

## 4. 기술 설계

- 표는 서버 렌더 (`YoyChart` 는 client) — pivot 은 이미 서버에 있고 `<a>` 는 Next `Link` 없이도 키보드 경로다. 지표 쿼리는 `historyMetricQuery` 규칙 그대로 (기본 지표는 생략 → URL 하나로 수렴).
- 연도 토글 (client state) 은 표에 반영하지 않는다 — 표는 "전부" 를 글자로 보이는 대응물이고, 토글은 시각 비교용.
- 시계열 · 계절성 포인트를 `<a>` 로 바꾸는 선택 항목은 하지 않는다 (§7).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/history/yoy-links.ts` (+ `__tests__/yoy-links.test.ts`) | 신규 · 순수 |
| `src/components/trends/YoyMonthTable.tsx` | 신규 |
| `src/app/trends/page.tsx` | `YoyView` 에 표 |
| `docs/specs/396-highlights.md` · `docs/designs/396-highlights/design-notes.md` | 표기 |

## 6. 테스트 계획

§3 F4 + 4종 검증. 배포 후: `/trends?view=yoy` 에서 Tab 으로 "월별 값 · 링크" 열고 칸 링크로 월 뷰 이동 · 스크린리더가 연도 · 월 · 값을 읽음 · 360px 가로 넘침 없음 (표는 `overflow-x-auto`).

## 7. 제외 사항

- 시계열 · 계절성 포인트를 Recharts custom shape 안의 `<a href>` 로 — SVG `<a>` 는 되지만 `role="img"` 컨테이너 안이라 AT 경로가 되지 않고, 두 뷰는 판독값 띠가 이미 키보드 경로다.
- 표의 연도 토글 연동.
