# [feat] 건강검진 이력 (1/2) — 스키마 · 항목 카탈로그 · 입력 · 추이 화면

- **작성일**: 2026-10-16
- **타입**: feat
- **이슈**: #527
- **브랜치**: `feat/527-1` (dev → dev)
- **마일스톤**: M18 건강 기록 (검진 · 복약) — 1/4
- **양식 출처**: 검진기관 온라인 결과 화면 (2026-10-16 확인 · 원본은 저장소 밖 · gitignore). **개인 검진 결과 (수치 · 판정 · 검진일 · 시행 항목) 는 이 문서 · 이슈 · 코드 · fixture · 커밋 어디에도 옮기지 않는다** — 일반적인 양식 구조만. 아래 예시 값은 전부 가상.

## 1. 배경

Garmin · OMRON 으로 일상 지표 (활동 · 수면 · 심박 · 체성분 · 혈압) 는 쌓이지만, **혈액 · 간 · 신장 · 지질 · 영상 검사** 같은 검진 결과는 앱 밖에 있다. 검진 이력을 저장하고 항목별 연도 추이를 보며, 이후 AI 어드바이저가 맥락으로 쓰게 한다 (M18-4).

입력 경로: 최근 회차는 온라인 결과 조회 + 그 이전은 **종이 결과지**. 이 이슈는 **폼 입력**까지, 결과지 (캡처 · PDF · 종이 사진) 추출은 M18-2. **모델은 처음부터 종이 결과지 추출을 전제로 설계**한다 (§5).

## 2. 양식 구조 (종합검진 온라인 결과 화면)

### 2-1. 화면 구조
- 검사 분류별 섹션 (계측 · 혈압 · 소변 · 혈액 · 장기 기능 · 대사 · 감염 · 영상 · 내시경 · 체성분 등).
- 각 행: `검사항목 | 금회결과 (결과 · 기준범위) | 과거결과 (결과 · 검진일자)`.
- **과거결과 검진일자가 항목마다 다를 수 있다** — 각 항목의 "직전 시행 회차". 한 화면 = 금회 1회차 + 과거 여러 회차의 **부분** 결과.
- **금회 검진일자는 결과 표에 없다** → 회차 헤더 (검진일 · 기관) 는 별도 입력.
- 섹션 단위 `소견` 목록 (예: "○○ 수치가 높습니다") + 항목 단위 설명문 (영상 · 내시경은 판독문 · 진단명 · 권고).

### 2-2. 단위
- **화면에 단위가 없다.** 단위 정본은 항목 카탈로그 (§4 C). 결과지 (종이) 에 단위가 있으면 결과별 `unit` 으로 보존.

### 2-3. 결과값 형태 (예시 값은 가상)
| 형태 | 예 | 저장 |
|---|---|---|
| 수치 | `12.3` · `0.45` · `1.000` | `valueNum` (+ 원문 `valueText`) |
| 정성 | `정상` · `유소견` · `-` · `+-` | `valueText` |
| 범위 문자열 | `0-2` (요침사 등) | `valueText` (수치로 해석하지 않음) |
| 참조 | `결과지 참조` | `valueText` |

### 2-4. 기준범위 형태 (예시 값은 가상)
| 형태 | 예 | 해석 |
|---|---|---|
| 하한-상한 | `10.0-20.0` · `0.100-1.000` | `refLow` · `refHigh` |
| 0-상한 | `0-40` | `refLow = 0` · `refHigh` |
| 정성 정상값 | `-,음성` · `+-,약양성` · `정상, (정상)` · `정상` | `refText` 만 |
| 없음 | (빈칸 — 신장 · 체중 등 기준이 없는 항목) | null |

### 2-5. 이상 표시
- 결과 글자색 2단계 (예: 파랑 · 빨강) = **기관 판정 등급**. 범위 이탈 방향 (높음 · 낮음) 과 대응하지 않는다.
- 기준범위 밖인데 표시가 없는 경우가 있을 수 있다 → 기관 판정을 그대로 저장하고 범위로 재판정하지 않는다 (§3-3).

### 2-6. 기존 모델과 겹치는 항목
신장 · 체중 · 허리둘레 · BMI · 혈압 · 맥박 · 체지방률 · 체지방량 · 근육량 — `BodyComposition` · `BloodPressure` 와 겹친다 (§3-2).

## 3. 결정 (2026-10-16 사용자 · 기획)

1. **입력**: 폼 (이 이슈) + 결과지 추출 (M18-2 · 종이 포함). 복약 (M18-3) · AI 연동 (M18-4) 은 후속.
2. **겹치는 항목은 검진 기록에만 저장** — `BodyComposition` · `BloodPressure` 에 쓰지 않는다. 측정 조건 (병원 · 공복) 이 다르고 기존 싱크 우선순위 (OMRON · manual · Garmin) 와 섞이지 않게.
3. **판정은 기관 값 우선**: 입력된 `flag` 를 저장. 없을 때만 수치 + `refLow/refHigh` 로 `normal` / `abnormal` 계산 (`caution` 은 계산하지 않는다).
4. **추적 권고**: 결과 단위 `followUp` (원문 권고) + `followUpDue` (날짜). 화면에 "다가오는 추적검사" 로 노출. **뒤 회차에서 같은 항목을 검사했으면 이행된 것으로 보고 목록에서 뺀다** (2/2 구현 중 추가).
5. **검진일당 회차 하나** (`HealthCheckup.date @unique` 유지 · 2026-10-16 사용자): 하루에 다른 검진을 두 번 받는 일은 없고, 병원 종합검진이 국가검진 항목을 포함한다 — 같은 날 결과는 한 회차 (`kind = comprehensive`) 에 담는다. M18-2 결과지 추출의 회차 병합 키도 날짜.

## 4. 요구사항

### 스키마 (migration 1 · 수동 SQL 경로 — `prisma-drift-fix`)
- [ ] S1 `HealthCheckup`
  - `id` · `date DateTime @unique` (KST 자정 instant) · `institution String?` · `kind String` (`national` | `comprehensive` | `other`) · `source String @default("manual")` (`manual` | `capture` | `pdf` | `photo`) · `summary String?` (종합 소견) · `findings Json?` (섹션 소견 `[{ category, text, flag? }]`) · `rawData Json?` (추출 원문 — M18-2) · `createdAt` · `updatedAt`
  - `kind` · `source` **DB CHECK 제약** (memory: source 컬럼 CHECK 패턴)
- [ ] S2 `CheckupResult`
  - `id` · `checkupId` (FK · `onDelete: Cascade`) · `itemCode String` · `label String` (결과지 원문 항목명) · `category String`
  - `valueNum Float?` · `valueText String?` (원문 — 수치여도 보존) · `unit String?`
  - `refText String?` (기준범위 원문) · `refLow Float?` · `refHigh Float?`
  - `flag String?` (`normal` | `caution` | `abnormal` · CHECK) · `flagSource String?` (`institution` | `computed`)
  - `note String?` (항목 설명 · 판독문) · `followUp String?` · `followUpDue DateTime?`
  - `@@unique([checkupId, itemCode])` · `@@index([itemCode])` · `@@index([followUpDue])`
  - `valueNum` · `valueText` 둘 다 null 금지 (CHECK)

### 항목 카탈로그 `src/lib/checkup/items.ts` (순수 상수)
- [ ] C1 항목: `code` · `label` · `aliases[]` · `category` · `unit` · `valueType` (`numeric` | `qualitative` | `text`) · `decimals`
- [ ] C2 종합검진 표준 섹션의 항목 (계측 · 소변 · 혈액 · 간 · 신장 · 당 · 지질 · 갑상선 · 감염 · 종양표지자 · 영상 · 내시경 · 체성분 등). 별칭에 화면 표기 · 흔한 다른 표기 (예: `γ-GTP` / `감마지티피` / `GGT`, `AST(SGOT)` / `AST`). 단위는 국내 검사실 표준 (mg/dL · g/dL · U/L · % · ×10³/μL 등) — 구현 시 항목별 확인.
- [ ] C3 카탈로그에 없는 항목: `itemCode = custom:<slug>` + 결과별 `unit` · `category`. 같은 slug 는 회차 간 같은 항목으로 묶인다.
- [ ] C4 `matchItem(label)` (순수) — 정규화 (공백 · 괄호 · 대소문자 · 그리스 문자) 후 code · 별칭 일치. M18-2 추출이 같은 함수를 쓴다.

### 파서 · 판정 (순수 · `src/lib/checkup/`)
- [ ] P1 `parseReference(text)` — §2-4 네 형태. 실패하면 `{ refText }` 만 (에러 아님).
- [ ] P2 `parseResultValue(text, valueType)` — §2-3. 범위 문자열 (`0-1`) 은 수치로 해석하지 않는다.
- [ ] P3 `resolveFlag({ flag, valueNum, refLow, refHigh })` — §3-3.

### API (`src/app/api/checkups/`)
- [ ] A1 `GET /api/checkups` (목록 · 회차별 이상 건수) · `POST` (회차 + 결과 일괄)
- [ ] A2 `GET` · `PUT` · `DELETE /api/checkups/[id]` — PUT 은 결과 전체 교체 (트랜잭션)
- [ ] A3 `GET /api/checkups/items/[code]` — 항목 추이 (회차별 값 · 기준범위 · flag)
- [ ] A4 zod 검증 · try-catch + `{ error }` · 날짜 `YYYY-MM-DD` → KST 자정 · 같은 날짜 회차 중복은 409

### 화면 `/medical` (사이드바 "건강 기록")
- [ ] U1 회차 목록 — 검진일 · 기관 · 종류 · 주의/이상 건수
- [ ] U2 회차 상세 — 섹션별 표 (결과 · 단위 · 기준범위 · 판정 · **직전 회차 대비 변화**) · 판독문 펼침 · 섹션 소견
- [ ] U3 항목 추이 — 항목 선택 → 회차별 점 · 선 + 기준범위 밴드 (수치) / 회차별 배지 타임라인 (정성). 단위가 회차마다 다르면 경고 표시
- [ ] U4 다가오는 추적검사 카드 — `followUpDue` 오름차순 · 지난 것 강조
- [ ] U5 입력 · 수정 폼 — 회차 헤더 + 섹션별 항목 (빈칸 = 미시행) · 사용자 항목 추가 · 기준범위 원문 입력 시 하한/상한 자동 해석 표시
- [ ] U6 다크 테마 · 모바일 반응형 · 수치 표기 규칙 (항목 `decimals`)

### 테스트 (vitest · **합성 값만**)
- [ ] T1 `parseReference` — §2-4 전 형태 + 깨진 입력
- [ ] T2 `parseResultValue` — 수치 · 정성 · 범위 문자열 · `결과지 참조`
- [ ] T3 `resolveFlag` — 기관 판정 우선 · 계산 · 범위 없음
- [ ] T4 `matchItem` — 별칭 · 정규화 · 미매칭 · 카탈로그 code 중복 없음 · 별칭이 두 항목에 겹치지 않음
- [ ] T5 API zod 스키마 — 날짜 · 값 둘 다 없음 · 중복 itemCode

## 5. 기술 설계 메모 (M18-2 결과지 추출 대비)
- **원문 보존**: `label` · `valueText` · `refText` 는 결과지 표기 그대로. 해석값 (`itemCode` · `valueNum` · `refLow/High`) 은 별도 컬럼 → 기관 · 연도마다 표기가 달라도 원문 재해석 가능.
- **회차 병합**: 한 화면에 금회 + 과거 여러 회차가 있으므로 추출은 날짜별로 회차를 만들거나 기존 회차에 **없는 항목만 추가** (기존 값 덮어쓰기는 확인 화면에서만). 이 이슈의 `@@unique([checkupId, itemCode])` · `date @unique` 가 그 기반.
- 결과별 `unit` · `refText` 저장 — 옛 결과지는 기준범위 · 단위가 지금과 다를 수 있다.
- 날짜는 `kstInstant` (`src/lib/history/buckets`).
- 기존 `BodyComposition` · `BloodPressure` · 싱크 코드는 건드리지 않는다.
- **개인정보**: 저장소 public — fixture · 스펙 · PR · 커밋 메시지에 실측 수치 금지. `capture/` gitignore (이 브랜치에 `.gitignore` 변경 포함).

## 6. 디자인
UI 기능 → workflow 4단계 필수. `frontend-design` 시안 → `docs/designs/527-health-checkup/` (prototype.jsx · design-notes.md). 시안 데이터는 합성.

## 7. 구현 전 확인
- [ ] 회차 헤더 입력값 (검진일 · 기관) — 사용자 확인 (문서에 기록하지 않음)
- [ ] 사이드바 위치 · 라벨 "건강 기록"
- [ ] 항목별 단위 확정 (C2)

## 8. 후속 (M18)
- **M18-2** 결과지 추출 — 캡처 · PDF · 종이 사진 → Claude → `matchItem` → 확인 화면 → 저장 (금회 + 과거결과 열 → 회차 병합). **종이 결과지 샘플로 검증** 항목 포함. 이미지는 처리 후 삭제.
- **M18-3** 복약 — `Medication` (처방약 + 영양제 · 기간) · 검진 추이 차트에 복용 기간 겹침.
- **M18-4** AI 연동 — MCP `get_checkup_history` · `get_medications` · 어드바이저 · 리포트 맥락.

## 9. 제외
- 국민건강보험공단 · 병원 시스템 자동 연동 (개인용 공식 API 없음).
- 의료 해석 생성 · 판정 재계산 (기관 판정 보존만).
- 단위 변환 (예: mmol/L ↔ mg/dL).
- 검진 수치를 `BodyComposition` · `BloodPressure` 에 반영.
