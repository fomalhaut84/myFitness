# [후속 #480] date-only 입력 (생일 · 목표일 · 수동 체성분) 을 KST 자정으로 저장

- **작성일**: 2026-09-28
- **타입**: fix (bug · P2)
- **이슈**: #480 (PR #478 Codex 2회차 P2)
- **브랜치**: `fix/480-1` (dev → dev)
- **의존**: #365 (`formatDateLocal` KST 읽기) · #393 (`kstInstant`)

## 1. 배경 (2026-09-28 실코드 재검증 — 유효)

`src/app/api/profile/route.ts` · `src/app/api/body-composition/route.ts` 의 `parseLocalDate("YYYY-MM-DD")` 는 `new Date(y, m - 1, d)` = **서버 로컬 자정**으로 저장한다 (같은 함수가 두 파일에 중복). #365 로 읽기 (`formatDateLocal` = `ymdKST`) 가 KST 가 되면서, 호스트 TZ 가 서울보다 **동쪽** (예: Pacific/Kiritimati) 이고 PM2 `TZ` 고정이 없을 때 새로 입력한 값이 하루 앞으로 읽히고 체성분은 조회 키 (KST 자정) 와도 어긋난다. KST · UTC (서쪽) 호스트는 무관. 프로덕션은 KST + `TZ` 고정이라 도달 불가. Garmin fetcher 가 쓰는 일별 키는 이미 KST 자정이라 수동 입력만 다른 규칙이었다.

## 2. 목표

date-only 입력은 **KST 자정 instant** 로 저장한다 — 호스트 TZ 와 무관, Garmin 일별 키와 같은 규칙. 중복 정의 2곳을 공용 순수 함수 하나로.

## 3. 요구사항

- [x] F1 `src/lib/date-input.ts` (순수): `parseDateOnlyKST(ymd)` — `isValidYmd` 검사 (실존하지 않는 날짜는 throw · 라우트는 zod 가 먼저 거른다) → `kstInstant(ymd)`.
- [x] F2 두 route 의 `parseLocalDate` 삭제 → `parseDateOnlyKST`. 동작: KST 호스트에서는 값 변화 없음 (`new Date(y, m-1, d)` = KST 자정).
- [x] F3 주석 정정: `format.ts` (`parseLocalDate` 언급) · `history/day.ts` (수동 체중이 서버 로컬 자정이라던 설명 — KST 범위 조회는 방어로 유지).
- [x] F4 회귀 테스트 `date-input.test.ts`: "2026-09-28" → `2026-09-27T15:00:00.000Z` · `ymdKST` 왕복 · 무효 날짜 throw. 전체 vitest 를 `TZ=UTC` 로도 실행.
- [x] F5 스펙 365 §4 · 이슈 제외 항목 갱신.

## 4. 기술 설계

- `kstInstant` (`src/lib/history/buckets.ts`) 를 그대로 쓰되, 입력 검증과 의도 (date-only → KST 자정) 를 이름에 담은 얇은 함수로. `buckets.ts` 는 prisma 의존 없음.
- 기존 행: KST 호스트에서 쓴 값은 이미 KST 자정 — 마이그레이션 불필요.
- `history/day.ts` 의 KST 하루 범위 조회는 옛 행 (다른 TZ 에서 썼을 가능성) 방어로 유지.

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/date-input.ts` (+ `src/lib/__tests__/date-input.test.ts`) | 신규 · 순수 |
| `src/app/api/profile/route.ts` · `src/app/api/body-composition/route.ts` | `parseLocalDate` → `parseDateOnlyKST` |
| `src/lib/format.ts` · `src/lib/history/day.ts` | 주석 |
| `docs/specs/365-server-tz-residuals.md` | §4 · §7 갱신 |

## 6. 테스트 계획

§3 F4 + 4종 검증. 배포 후: 프로필 생일 · 목표일 저장 → 표시 같은 날 · 체성분 수동 입력 → `/history/<ymd>` 일 뷰에 표시 (KST 호스트라 변화 없음이 정상).

## 7. 제외 사항

- 옛 행 재정규화 — KST 호스트 기록이라 불필요.
- `training-plan` 의 날짜 (`toUtcDateOnly` — UTC 자정 규칙) — 별개 규칙 · 범위 밖.
