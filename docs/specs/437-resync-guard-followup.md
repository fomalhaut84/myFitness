# [후속 #437] 재싱크 가드 후속 — 숫자 문자열 값 인식 · trimmed 시 sleepScoreDetails 보존

- **작성일**: 2026-09-28
- **타입**: chore (P2)
- **이슈**: #437 (PR #436 · 릴리즈 PR #434 Codex 2회차 P2)
- **브랜치**: `fix/437-1` (dev → dev)
- **의존**: #431 · #435 (`src/lib/garmin/preserve.ts`)

## 1. 배경

#431 · #435 의 재싱크 덮어쓰기 가드 (`isTrimmedResponse`) 는 기존 rawData 의 "값 있음" 키가 응답에서 사라졌는지로 보존 창 밖 재조회를 판정한다. Codex 가 두 가지 빈틈을 지적했다 (2026-09-28 실코드 재검증 — 둘 다 유효).

1. **숫자 문자열** — `isPresent` 는 문자열을 전부 "값 없음" 으로 본다. `extractSleepSpO2` 가 받아들이는 숫자 문자열 (`"94"`) 이 기존 rawData 에 있다가 응답에서 빠져도 trimmed 로 감지되지 않고, 반대로 수 → 문자열 (`94` → `"94"`) 은 trimmed 로 오판된다. 로컬 · 프로덕션 rawData 에서 숫자 문자열이 관찰된 적은 없다 (방어적 파서와 같은 규칙으로 맞추는 것).
2. **`sleepScoreDetails` 덮어쓰기** — `sleep.ts` 는 `trimmed` 여도 `...scoreDetails` spread 를 그대로 넣는다. 트림된 응답에 `dto.sleepScores` 가 부분적으로 남아 있으면 (`overall` 만 있고 비율 · qualifier 없음) rawData 는 보호되지만 `sleepScoreDetails` JSON 은 null 섞인 값으로 덮어써진다.

## 2. 목표

1. `isPresent` 가 숫자 문자열을 수와 같은 규칙으로 센다 (비지 않음 · 유한 · 0 아님).
2. `trimmed` 면 `sleepScoreDetails` 도 rawData 와 같은 규칙으로 생략 (기존 유지).
3. `sleep.ts` 의 payload 조립을 **순수 함수**로 빼서 2 를 회귀 테스트로 고정한다 (fetcher 는 Prisma 호출만).

## 3. 요구사항

- [x] F1 `preserve.ts` `isPresent`: `typeof v === "string"` 이면 `trim() !== "" && Number.isFinite(Number(v)) && Number(v) !== 0` 일 때 값 있음. 날짜 · qualifier 같은 비숫자 문자열은 그대로 "값 없음" (요약 플래그).
- [x] F2 `fetchers/sleep-payload.ts` (신규 · 순수): `buildSleepScoreDetails(dto)` · `buildSleepRecordData(sleepData)` · `buildSleepUpdatePayload(data, scoreDetails, { trimmed })` — trimmed 면 `rawData` 와 `sleepScoreDetails` 둘 다 생략.
- [x] F3 `fetchers/sleep.ts`: 위 함수로 교체 (trimmed 규칙 확장 외 동작 동일 — 단 단계 초가 숫자 아닌 문자열이면 NaN 대신 null, `"0"` 문자열은 0 대신 null · 사전 리뷰 info 2). `toInt` · `toFloat` 는 payload 모듈 내부로 (export 없음 · info 3).
- [x] F4 회귀 테스트 (vitest):
  - `preserve.test.ts`: `"94"` → 없음 = trimmed · `94` → `"94"` = trimmed 아님 · `"0"` · `""` · `" "` · 날짜 문자열은 값 없음
  - `sleep-payload.test.ts`: trimmed 면 update 에 `rawData` · `sleepScoreDetails` 없음 (회귀: 릴리즈 PR #434 Codex P2) · trimmed 아니면 둘 다 포함 · `sleepScores` 없으면 키 자체 없음 · 초 → 분 변환 · 입력 불변

## 4. 기술 설계

- `isPresent` 의 문자열 분기는 `sleep-spo2.ts` `toSpO2` 의 문자열 처리 (trim → Number) 와 같은 규칙. 범위 검사 (0 < n ≤ 100) 는 SpO2 전용이라 가드에는 두지 않는다.
- `buildSleepUpdatePayload` 는 `preserveUpdate` 위에 `sleepScoreDetails` 규칙을 얹는다: `trimmed ? preserveUpdate(data, { trimmed }) : { ...preserveUpdate(data, { trimmed }), ...scoreDetails }`. create 경로는 그대로 (`DbNull`).
- 입력 타입은 `@flow-js/garmin-connect` 의 `SleepData` · `SleepDTO`. 런타임은 기존처럼 optional chaining 으로 방어 (실응답이 타입보다 빈약할 수 있다).

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/garmin/preserve.ts` | `isPresent` 숫자 문자열 |
| `src/lib/garmin/fetchers/sleep-payload.ts` (+ `__tests__/sleep-payload.test.ts`) | 신규 · 순수 |
| `src/lib/garmin/fetchers/sleep.ts` | payload 조립을 순수 함수로 교체 |
| `src/lib/garmin/__tests__/preserve.test.ts` | 숫자 문자열 회귀 |
| `docs/specs/431-wellness-overwrite-guard.md` | §7 한계에 후속 반영 표기 |

## 6. 테스트 계획

§3 F4. 4종 검증 (`lint / typecheck / test / build`). 실 API 호출 없음 — 로컬 dev DB 검증 불필요 (순수 함수 + 회귀 테스트로 대체).

## 7. 제외 사항

- **알려진 한계 (사전 리뷰 info 1)**: trimmed 면 `sleepScoreDetails` 를 통째로 생략하므로 (a) `sleepScore` 컬럼은 갱신되는데 `sleepScoreDetails.overall` 은 옛 값으로 남아 어긋날 수 있고, (b) 기존 행의 `sleepScoreDetails` 가 DbNull 인데 trimmed 응답이 완전한 점수를 담고 있어도 채워지지 않는다. 보존 창 밖 행은 첫 싱크 때 완전한 값이 들어가므로 실제 영향은 작다. 더 정확히 하려면 기존 `sleepScoreDetails` 도 select 해 소실 여부를 따로 판정 — 필요해지면 별도 이슈.

- `heart-rate.ts` 의 payload 순수 분리 — `sleepScoreDetails` 같은 별도 JSON 컬럼이 없어 현재 `preserveUpdate` 만으로 충분. 필요해지면 같은 패턴.
- 문자열 안의 단위 · 통화 등 숫자가 아닌 표기 (`"94%"`) 는 값 없음 그대로 (Garmin 응답에 없음).
