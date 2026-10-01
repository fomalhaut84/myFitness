# [fix] BMI 미표시 · 프로필 maxHR / LTHR Garmin 자동 싱크 미동작

- **작성일**: 2026-10-01
- **타입**: fix (bug · P1)
- **이슈**: #505
- **브랜치**: `fix/505-1` (dev → dev)

## 1. 배경 (2026-10-01 프로덕션 실측)

### BMI
- `/body` 상단 BMI 가 `—`. 프로필에 키 (170 cm) 입력됨.
- `BodyComposition` 375행 전부 `source = garmin` · **`bmi` 0행 · `bodyFat` 0행** — Garmin weight API 는 체중만 기록하면 `bmi = null` 을 준다.
- 키로 BMI 를 계산하는 경로는 수동 입력 API (`src/app/api/body-composition/route.ts`) 뿐. Garmin 행은 Garmin 값 그대로 (`src/lib/garmin/fetchers/body-composition.ts`) → 표시값 `latest.bmi` 가 null.

### 프로필 maxHR / LTHR
- `MetricChange` 이력 14행 중 `source = garmin` 은 `vo2maxRunning` 3건뿐. **maxHR · LTHR · LTHR 페이스는 자동 싱크로 바뀐 적이 한 번도 없다.** 사용자는 Garmin 성과통계 / 시계 스포츠 심박수 값을 보고 수동 입력해 왔다 (05-02 ~ 09-29 · 11건 — 값은 Garmin LT 감지 이력과 일치: 08-25 327 sec/km · 09-15 153 · 09-29 155).
- 원인: `applyAutoSync` (`src/lib/garmin/fetchers/user-profile.ts`) 의 보호 규칙 **"source === null + 값 있음 → 마이그레이션 전 데이터로 보고 manual 간주"**. source 컬럼 도입 이전부터 값이 있던 프로필 (05-02 첫 이력의 oldValue 157) 은 영구히 자동 갱신 불가 → 사용자 수동 입력 → `source = manual` → 계속 불가. 싱크는 매일 06:00 cron 과 "지금 싱크" 에서 돌지만 매번 조용히 skip 하고 UI 는 "동기화 완료".
- `source = manual` 을 되돌리는 UI 가 없다 (두 값을 모두 비우는 것 외에는).
- 대조: `vo2maxRunning` 은 보호 규칙이 없어 정상 추종.
- 2026-10-01 Garmin 직접 조회 (읽기 전용): RUNNING 존 maxHR 175 · LTHR 155, user-settings LTHR 155 · 속도 0.30833 (= 324 sec/km), LT 감지 이력 최신 09-29 155 — 현재 DB 값과 일치.

## 2. 목표

1. BMI 가 저장돼 있지 않으면 체중 + 프로필 키로 계산해 표시한다.
2. Garmin 값이 maxHR · LTHR 를 자동으로 따라오게 한다 — 사용자가 **명시적으로** 수동 입력한 값만 보호하고, 그 보호는 되돌릴 수 있다.
3. 수동 보호 중인 항목은 현재 Garmin 값과 나란히 보여 차이를 알 수 있게 한다.

## 3. 요구사항

- [ ] F1 `src/lib/fitness/bmi.ts` (순수): `computeBmi(weightKg, heightCm)` (소수점 1자리 · 키 없거나 0 이하면 null) · `resolveBmi(storedBmi, weightKg, heightCm)` (저장값 우선, 없으면 계산).
- [ ] F2 BMI 소비처를 `resolveBmi` 로: `/body` 상단 · 최근 기록 · CSV 내보내기 (`type=body`) · MCP `getBodyComposition` (집계 전 행 단위). 수동 입력 API 의 인라인 계산도 `computeBmi` 로 교체. **DB 는 바꾸지 않는다** (키 변경 시 표시도 따라감 · Garmin 원본 보존 원칙).
- [ ] F3 보호 규칙: `canAutoUpdate(source)` = `source !== "manual"` (순수 함수로 추출). maxHR · LTHR (+pace) · 안정시 심박 공통. "null + 값 = manual 간주" 제거 — 덮어쓰더라도 `MetricChange` 에 이전 값이 남는다.
- [ ] F4 `PATCH /api/profile` 에 `revertToGarmin: ("maxHR" | "lthr")[]` — 해당 source 를 `"garmin"` 으로 설정 (값은 그대로 · 다음 싱크가 Garmin 값으로 갱신). 같은 요청에서 그 필드 값을 바꾸면 400.
- [ ] F5 프로필 "Garmin 자동 동기화" 카드: 항목별 `수동` 배지 옆 **"Garmin 자동으로"** 버튼 → `revertToGarmin` → `/api/sync` (user_profile) → refresh.
- [ ] F6 같은 카드에 현재 Garmin 값 표시: maxHR · LTHR 은 저장된 `heartRateZonesRaw` (RUNNING 존, 매 싱크 갱신 · 보호와 무관) — 수동 값과 다르면 강조. 순수 파서 `extractGarminZoneValues(raw)` (외부 JSON 검증). LTHR 페이스는 최신 `FitnessMetricDaily.lthrPace` 를 **감지 날짜와 함께 참고로만** 표시 — 싱크가 쓰는 user-settings 현재값과 출처가 달라 비교 · 강조하지 않는다 (사전 리뷰 major 1).
- [ ] F7 "지금 싱크" 결과 메시지: 수동 보호 항목이 있으면 `동기화 완료 — 수동 항목(maxHR · LTHR)은 갱신하지 않음` 으로 구분.
- [ ] F8 회귀 테스트 (vitest): `bmi.test.ts` · `profile-sync-rules.test.ts` (null source + 값 → 갱신 가능 · manual → 불가 · garmin → 가능) · `garmin-profile-values.test.ts` (raw 파싱 · 잘못된 형태 → null).

## 4. 기술 설계

- BMI 는 **표시 시점 계산**. 저장 계산 (싱크 시 채우기) 은 키 변경 시 과거 행이 낡고, Garmin 원본과 계산값이 한 컬럼에 섞인다.
- MCP `getBodyComposition` 는 `bmi` 를 집계 필드로 쓰므로 `findMany` 직후 행 단위로 `resolveBmi` 를 적용한 뒤 집계한다. 키는 `userProfile.findFirst` 1회.
- 보호 규칙 변경 효과 (프로덕션): 현재 둘 다 `manual` 이라 F3 만으로는 바뀌지 않는다 — 배포 후 F5 버튼으로 되돌리면 다음 싱크부터 추종. source null 인 신규 / 레거시 프로필은 즉시 추종.
- `revertToGarmin` 은 source 만 바꾸고 이력 (`MetricChange`) 은 남기지 않는다 — 값 변화는 이어지는 싱크가 `garmin` 출처로 기록한다.
- 프로필 폼은 `initialKey` 로 refresh 시 재초기화되므로 (기존) 되돌리기 → 싱크 → refresh 후 낡은 값으로 저장해 manual 로 다시 뒤집히는 경로는 없다.
- UI 는 기존 카드 안 배지 줄 확장 (새 페이지 · 레이아웃 없음) — 디자인 단계는 아래 배치로 갈음:

```
Garmin 자동 동기화                               [지금 싱크]
maxHR  [수동] 175 · Garmin 175        [Garmin 자동으로]
LTHR   [수동] 155 · 5:24 · Garmin 155    [Garmin 자동으로]
Garmin LT 감지 페이스: 5:24/km (2026-09-29)
VO2max 45
마지막 싱크: …
```

## 5. 변경 파일

- 신규: `src/lib/fitness/bmi.ts` · `src/lib/garmin/profile-values.ts` · `src/app/settings/profile/garmin-sync-section.tsx` (카드 분리) · 테스트 3개
- 수정: `src/app/body/page.tsx` · `src/app/api/export/route.ts` · `src/mcp/tools/fitness.ts` · `src/app/api/body-composition/route.ts` · `src/lib/garmin/fetchers/user-profile.ts` · `src/app/api/profile/route.ts` · `src/app/settings/profile/page.tsx` · `src/app/settings/profile/profile-client.tsx`
- DB 마이그레이션 없음 · 패키지 추가 없음

## 6. 테스트 계획

- vitest: F8 3파일 (`TZ=UTC` 포함 전체 통과).
- 4종 검증: `npm run lint && npm run typecheck && npm run test && npm run build`.
- 로컬 확인: `/body` BMI 표시 (로컬 DB 스냅샷) · 프로필 카드 배지 / Garmin 값 / 버튼.
- 배포 후: `/body` BMI ≈ 체중 / 1.70² · 프로필 "Garmin 자동으로" 2회 → 배지 `Garmin 자동` · 다음 LT 감지 뒤 `MetricChange` 에 `lthr … garmin` 행.

## 7. 제외 사항

- 체지방률 · 근육량: Garmin 이 주지 않는다 (체성분 체중계 없음) — 수동 입력 경로 유지.
- 안정시 심박 되돌리기 버튼 (F3 규칙은 공통 적용 · UI 배지는 기존대로 maxHR · LTHR 만).
- DEFAULT 존 (LTHR 166) 사용 — 러닝 우선 원칙대로 RUNNING 존 유지.
