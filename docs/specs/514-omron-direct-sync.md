# [feat] OMRON Connect 직접 연동 — 혈압 · 체중/체성분 자동 수집

- **작성일**: 2026-10-15
- **타입**: feat
- **이슈**: #514
- **브랜치**: `feat/514-1` (dev → dev)
- **프로토콜 출처**: 자체 PoC 실측 (2026-10-15 · 읽기 전용). 참고: bugficks/omramin (GPL-2.0 · **코드 미사용** — #514 결정 코멘트)

## 1. 배경

OMRON 혈압계 · 체중계 측정값을 OMRON Connect (iOS) → **Garmin Connect 에 수동 입력** → Garmin 싱크로 가져오고 있다. 수동 입력을 없애고 OMRON Connect Cloud 에서 직접 가져온다. Garmin 은 체성분을 체중만 받아 BMI · 체지방 등이 비어 있다 (#505 실측: `bmi` · `bodyFat` 0행).

## 2. PoC 실측 (2026-10-15 · 한국 계정)

### 2-1. 인증 · 엔드포인트
- 서버: 한국 계정은 아시아 리전 v1 API (`OMRON_API_BASE`). 요청 헤더 `X-Kii-AppID` · `X-Kii-AppKey` (OMRON 앱 값 — **`.env` 만, 커밋 금지**) + `content-type: application/json`. 앱 버전 헤더 없이 통과.
- `POST {base}/oauth2/token` `{ username, password }` → `{ id, access_token, refresh_token, expires_in: 3600, token_type }`. 이후 `authorization: Bearer <access_token>`.
- 갱신: 같은 엔드포인트 `{ grant_type: "refresh_token", refresh_token }` → 새 access token (3600초). **refresh token 은 회전하지 않고 재사용 가능** (실측 2026-10-15).
- 기기 목록: `POST {base}/apps/{appId}/server-code/versions/current/synchronizeDeviceConfData` `{ countOnlyFlag: 0, lastSyncDate: 0 }` → `returnedValue.syncList[].deviceCategoryList[].deviceModelList[].deviceSerialIDList[]` (`deviceSerialID` · `userNumberInDevice`). `nextPaginationKey` 가 있으면 다음 페이지.
- 측정값: `POST …/measureData` `{ containCorrectedDataFlag: 1, containAllDataTypeFlag: 1, deviceCategory, deviceSerialID, userNumberInDevice, searchDateFrom, searchDateTo }` (epoch ms) → `returnedValue.deviceModelList[].deviceSerialIDList[].measureList[]` (**최신순**).
- `accept-encoding: identity` 로 비압축 응답 — gzip 문제 없음.

### 2-2. 기기 · 데이터 범위
| 기기 | category | 모델 | user | 이력 |
|---|---|---|---|---|
| 혈압계 | `"0"` | HEM-7600T_W | 1 | 2026-04-16 ~ · 113건 · 32일 중 30일이 하루 여러 번 (최대 6) |
| 체중계 | `"1"` | HBF-222T-AP | 1 | 2026-05-15 ~ · 72건 · 47일 중 20일이 여러 번 (최대 4) |

`userNumberInDevice = 0` 은 공용 슬롯 — 측정 없음, 제외. 10년 범위 1회 호출로 전체 이력 반환 (측정값 쪽 페이지네이션 미관찰).

### 2-3. 측정 레코드
`{ measureDateTo (UTC epoch ms), timeZone: "Asia/Seoul", measureDeviceDateTo ("YYYYMMDDHHmmssSSS" 로컬), transferDate, bodyIndexList, … }`.
`bodyIndexList[code] = [value, unitCode, exponent, ?]` (문자열) → **값 = value × 10^exponent**.

**혈압계 코드** (실측 · 2026-10-15 측정 152/103/72 확인):
| 코드 | 의미 |
|---|---|
| 1 · 2 · 3 | 수축기 · 이완기 (mmHg) · 맥박 (bpm) |
| 6 · 7 · 13 · 14 | 항상 0 · 8 · 15 항상 1 — 의미 미확정 → rawData |
| 11 · 12 | 0/1 변동 — 불규칙 심박 · 움직임 감지 후보, **미확정** → rawData (확정 후 노출은 후속) |

**체중계 코드** (2026-09-23 08:20 측정을 OMRON 앱 화면과 대조 · 사용자 확인):
| 코드 | 값 예 | 의미 |
|---|---|---|
| 257 | 89.0 | 체중 kg (단위코드 8195 = kg · 272 동일값) |
| 262 | 30.8 | BMI |
| 259 | 27.1 | 체지방률 % |
| 261 | 31.6 | 골격근률 % |
| 294 | 28.1 | 골격근량 kg (= 체중 × 골격근률) |
| 295 | 24.1 | 체지방량 kg |
| 264 | 18 | 내장지방 레벨 |
| 260 | 1894 | 기초대사 kcal |
| 263 | 56 | 체연령 |
| 258 · 265~271 · 274 · 296 · 297 | — | 미확정 → rawData |

## 3. 결정 (2026-10-15 사용자)
1. **하루 대표 체중 = 그 KST 날짜의 가장 이른 측정.** 나머지 측정은 rawData 에 보존.
2. **체성분 추가 컬럼**: 내장지방 레벨 · 기초대사 · 체연령 · 골격근률 — nullable 추가 마이그레이션.
3. **중복 = OMRON 우선.** OMRON 데이터가 있는 날짜는 OMRON 이 행을 가진다. Garmin 싱크는 `source = omron` 행을 덮지 않는다. `manual` 은 계속 보호. 덮어쓴 Garmin 원본은 rawData 에 보존.

## 4. 요구사항

### 스키마
- [ ] S1 `BloodPressure.source String @default("garmin")` — `"garmin" | "omron"`. 기존 행은 기본값 `garmin`.
- [ ] S2 `BodyComposition` 에 `visceralFatLevel Float?` · `basalMetabolism Int?` (kcal) · `bodyAge Int?` · `skeletalMusclePct Float?` (%) 추가. `source` 주석 `"garmin" | "manual" | "omron"`.
- [ ] S3 `muscleMass` (kg) 에는 OMRON **골격근량 (294)** 을 넣는다 — 기존 Garmin `muscleMass` 도 kg 이지만 정의 차이 (Garmin 근육량 vs 골격근량) 를 컬럼 주석에 남긴다.

### OMRON provider (`src/lib/omron/`)
- [ ] P1 `config.ts` — env 검증 (zod). `OMRON_EMAIL` · `OMRON_PASSWORD` · `OMRON_APP_ID` · `OMRON_APP_KEY` · `OMRON_API_BASE` 중 하나라도 없으면 **비활성** (싱크 skip · 로그 1회 · 에러 아님).
- [ ] P2 `client.ts` — 로그인 · refresh · 401 시 1회 재인증. refresh token 은 `.omron-tokens/` (gitignore · 파일 권한 0600) 에 저장. 토큰 · 비밀번호는 로그 금지.
- [ ] P3 `parse.ts` (순수) — 응답 → `OmronBpReading[]` · `OmronScaleReading[]`. 외부 JSON 이라 zod 로 형태 검증, 필수 코드 (혈압 1·2·3 / 체중 257) 없는 레코드는 skip + 경고. `value × 10^exponent`.
- [ ] P4 `aggregate.ts` (순수) — 혈압: KST 날짜별 high/low 수축기 · 이완기 · 평균 맥박 · 횟수 · `category` · `measurements` (개별값 + 원본 코드). 체성분: KST 날짜별 **가장 이른** 측정 → 행, 그날 전체 측정은 rawData.
- [ ] P5 혈압 `category`: 측정별 분류 후 **그날 가장 높은 단계** (Garmin 과 같음 — §7). 측정별 기준 (AHA 2017 · Garmin 값과 일치):
  - `STAGE_2_HIGH`: 수축기 ≥ 140 **또는** 이완기 ≥ 90
  - `STAGE_1_HIGH`: 수축기 130–139 **또는** 이완기 80–89
  - `HIGH_NORMAL`: 수축기 120–129 **그리고** 이완기 < 80
  - `NORMAL`: 수축기 < 120 **그리고** 이완기 < 80
- [ ] P6 `sync.ts` — 기기 목록 → category `"0"`/`"1"` · user ≠ 0 기기별 측정 조회 → 저장. 초기 365일 · 이후 증분 (`SyncMetadata` dataType `omron_blood_pressure` · `omron_body_composition`).

### 저장 · 중복
- [ ] D1 OMRON 저장: `manual` 행은 건너뛴다. 그 외 (없음 · garmin · omron) 는 OMRON 값으로 upsert. 기존 garmin 행을 덮을 때 `rawData = { omron: <그날 측정>, replacedGarmin: <이전 rawData> }`.
- [ ] D2 Garmin `syncBloodPressure` · `syncBodyComposition` 은 `source` 가 `omron` 인 행을 덮지 않는다 (체성분은 기존 `manual` 보호 조건 확장 · 혈압은 같은 패턴 신규).

### 실행 경로
- [ ] R1 06:00 KST cron · "지금 싱크" (`/api/sync`) · 봇 `/sync` 에서 Garmin 다음에 OMRON 실행. **OMRON 실패가 Garmin 결과에 영향 주지 않음** (별도 try · 별도 결과 항목).
- [ ] R2 실패 시 기존 관리자 알림 경로 재사용 (OMRON 인증 실패 구분).

### 소비처 · UI
- [ ] U1 `/body` · `/heart` 최근 값 옆 출처 배지 (`OMRON` / `Garmin` / `수동`). `/body` 에 내장지방 · 기초대사 · 체연령 · 골격근률 표시 (값 있을 때만).
- [ ] U2 MCP `getBodyComposition` · `getBloodPressure` · CSV export 에 새 필드 · `source` 포함.

### 테스트 (vitest · 합성 fixture — 실측 원본은 커밋하지 않는다)
- [ ] T1 `parse` — 지수 변환 · 필수 코드 누락 skip · 형태 불일치.
- [ ] T2 `aggregate` — KST 경계 (00:30 KST 측정 = 그 날짜) · 가장 이른 측정 선택 · 혈압 high/low/평균/category.
- [ ] T3 중복 정책 순수 판정 (`manual` 보호 · garmin → omron 교체 · Garmin 이 omron 행 skip).

## 5. 기술 설계 메모
- 기존 Garmin fetcher 패턴 (`src/lib/garmin/fetchers/*`) · `SyncMetadata` 를 따른다. omramin 구조 · 이름을 따르지 않는다.
- 날짜: `measureDateTo` (UTC epoch) 를 KST 날짜로 변환 (`ymdKST`) → KST 자정 instant. `measureDeviceDateTo` 는 보조 (rawData).
- 네트워크 호출은 `undici` (프로젝트 의존성) 또는 Node fetch + 타임아웃. 레이트 리밋 기존 `withRateLimit` 재사용 검토.
- 서버 `.env` 에 OMRON 5개 변수 추가는 배포 전 사용자 작업.

## 6. 디자인
UI 변경은 기존 카드에 배지 · 필드 행 추가 수준 → 시안 생략, 구현 계획에 배치만 기록 (workflow 4단계 범위 판단).

## 7. 구현 전 확인
- [x] 프로덕션 `BloodPressure` Garmin 행 대조 (2026-10-15 · 28행): 일 category = 측정별 category 의 **최댓값** (예: 04-28 `[S1, S2]` → S2 · 04-20 `[S2, S2, NORMAL]` → S2). 경계: 134/90 → S2 · 130/89 · 122/82 → S1 (이완기 80–89 단독으로 S1) — AHA 2017 과 모순 없음. 수축기 ≥ 140 · `HIGH_NORMAL` 은 관찰 없음 (AHA 기준 적용).
  - 참고: Garmin 행은 28일 (수동 입력분) · OMRON 은 같은 기간 32일 · 113건 → OMRON 이 상위집합.
- [x] refresh token 갱신 실측 — 동작 · 비회전 (§2-1).

## 8. 제외
- 혈압 플래그 (불규칙 심박 · 움직임 · 커프) 의미 확정과 노출 — rawData 보존만, 후속 이슈.
- 체중계 미확정 코드 · 부위별 값 · 임피던스.
- OMRON v2 (미국 · 유럽) 리전.
- Garmin 으로 역동기화.
- 기존 Garmin 행 삭제 · 정리.
