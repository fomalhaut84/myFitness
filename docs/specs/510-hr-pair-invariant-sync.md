# [fix] 자동 싱크가 LTHR ≤ maxHR 불변식을 우회

- **작성일**: 2026-10-15
- **타입**: fix (bug · P2)
- **이슈**: #510 (발견: pleiades 정기 수용 리뷰 · Codex P2 · 검토 코멘트 2026-10-15)
- **브랜치**: `fix/510-1` (dev → dev)

## 1. 배경
- `PATCH /api/profile` 은 저장될 상태로 `LTHR ≤ maxHR` 을 검증한다 (`route.ts:104-125`).
- `applyAutoSync` (`src/lib/garmin/fetchers/user-profile.ts`) 는 필드별 `canAutoUpdate(source)` 만 보고 **결합 검증이 없다**. 한쪽만 `manual` 이면 Garmin 이 다른 쪽을 바꿔 불변식이 깨진다.
  - 정방향: 수동 maxHR 170 · Garmin LTHR 175 → LTHR 175 저장.
  - 역방향: 수동 LTHR 175 · Garmin maxHR 170 → maxHR 170 저장.
  - `revertToGarmin` (#506) 은 source 만 바꾸므로 그 시점 검증은 통과하고 다음 싱크에서 깨진다 — 경로 중 하나일 뿐 원인은 혼합 상태 전반.
- 영향: `getZoneRanges` zone 5 가 `175 ~ 170` 으로 뒤집혀 AI 시스템 프롬프트 · MCP fallback 에 노출. zone 판정 (`getHRZone`) 은 LTHR 만 써서 무관. 크래시 · 데이터 손실 없음.
- 프로덕션 현재 상태 (두 필드 `garmin`) 에서는 발생하지 않는다.

## 2. 요구사항
- [x] R1 순수 `findHrPairConflict` (`src/lib/garmin/profile-values.ts`): 싱크 후 상태가 `LTHR > maxHR` 이면 **수동 값과 충돌하는 Garmin 쪽** 필드를 반환. 둘 다 Garmin 이 쓰거나 수동 쪽이 없으면 null. 같음은 허용 (API 와 같은 기준). maxHR 이 비는 경우 (Garmin 이 null 로 비우는 경우 포함) 는 API 처럼 `resolveMaxHR` fallback (나이 기반 · 기본 190) 과 비교 (PR #513 Codex P2).
- [x] R2 `applyAutoSync`: 반환된 필드 갱신만 보류 (사용자 입력 우선). LTHR 은 pace · `lthrAutoDetected` · `lthrMeasuredAt` · source 까지 한 쌍으로 보류. `console.warn` 로그. 다음 싱크에서 재판정.
- [x] R3 프로필 "Garmin 자동 동기화" 카드: 보류 중인 행에 `Garmin N bpm 보류 (LTHR이 최대심박수보다 높아짐 — 페이스 포함 · 수동 값 확인)` — 저장된 러닝 존 값으로 같은 판정을 재현. LTHR 보류 중에는 페이스 · 감지 메타도 갱신되지 않는다 (R2).
- [x] R4 방어: `getZoneRanges` 는 `maxHR < zone 5 하한` 이면 상한을 비운다 (`N+ bpm`).
- [x] R5 회귀 테스트: `src/lib/garmin/__tests__/hr-pair-conflict.test.ts` (정 · 역방향 · 경계 · 비대상) · `src/lib/fitness/__tests__/zones.test.ts`.

## 3. 기각한 대안
- **두 필드를 함께 되돌리기**: 역방향 · 처음부터 한쪽만 수동인 경우를 못 막고, "maxHR 은 필드 테스트 수동 · LTHR 은 Garmin" 같은 정당한 조합을 금지한다.
- **Garmin 값으로 수동 값까지 덮기**: 사용자 의도 무시 (#505 의 보호 원칙과 반대).

## 4. 제외
- Garmin 값끼리의 불일치 (둘 다 `garmin`) — Garmin 존 정의에 맡긴다. R4 가 표시만 방어.
- UI 보류 표시는 `heartRateZonesRaw` (러닝 존) 만 본다 — 싱크가 존 LTHR null 일 때 쓰는 user-settings LTHR fallback 으로 보류되면 카드에 표시되지 않고 서버 `console.warn` 만 남는다 (역 — UI 만 보류 표시 — 는 없다. 사전 리뷰 info 1).
- 보류 이력 영속화 (`MetricChange` 등) — 다음 싱크에서 매번 재판정하므로 상태를 따로 두지 않는다.
- UI 디자인 단계 — 기존 카드 행에 한 줄 추가 (#505 배치 그대로).
